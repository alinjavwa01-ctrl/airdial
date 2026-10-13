// The agent loop: plan -> read -> act -> (approval gate) -> report.
// Runs in the side panel. The model call goes through the Gateway; tools run
// against the user's real browser.

import type Anthropic from '@anthropic-ai/sdk';
import * as browser from '../browser/bridge';
import { BrowserError } from '../browser/bridge';
import { load, nowIso, uid, update } from '../store/storage';
import type { PendingQuestion, PlanStep, Task, TaskLogLine, TaskStatus } from '../store/types';
import { costOf, makeGateway, GatewayConfigError, type Gateway, type MessageParams } from './gateway';
import { systemPrompt, taskPreamble } from './prompt';
import { CUSTOM_TOOLS, SERVER_TOOLS, ToolError, dueContacts, runTool, type ToolContext } from './tools';

const MAX_TURNS = 60;

export interface RunnerHooks {
  queueDraft: ToolContext['queueDraft'];
  /** Lets tests swap in a fake model. */
  gateway?: Gateway;
}

export interface RunOptions {
  /** Approve-tier actions in this task are pre-approved (used to send an already approved message). */
  preApproved?: boolean;
  tabId?: number;
}

type Resolver = (value: string | boolean) => void;

export class TaskRunner {
  readonly task: Task;
  private messages: Anthropic.Beta.BetaMessageParam[] = [];
  private abort = new AbortController();
  private paused = false;
  private resumeWaiters: (() => void)[] = [];
  private pendingResolver?: Resolver;
  private tabId?: number;
  private saveTimer?: ReturnType<typeof setTimeout>;
  private listeners = new Set<(t: Task) => void>();

  constructor(prompt: string, private hooks: RunnerHooks, private opts: RunOptions = {}) {
    this.task = { id: uid('t_'), prompt, createdAt: nowIso(), status: 'running', plan: [], log: [], usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 } };
    this.tabId = opts.tabId;
  }

  onChange(fn: (t: Task) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  // ----- controls -----

  pause() {
    if (this.task.status !== 'running') return;
    this.paused = true;
    this.setStatus('paused');
    this.log('Paused', 'user');
  }

  resume() {
    if (!this.paused) return;
    this.paused = false;
    this.setStatus(this.task.pending ? 'needs_you' : 'running');
    this.log('Resumed', 'user');
    this.resumeWaiters.splice(0).forEach((r) => r());
  }

  stop() {
    if (['done', 'error', 'stopped'].includes(this.task.status)) return;
    this.abort.abort();
    this.pendingResolver?.(false);
    this.paused = false;
    this.resumeWaiters.splice(0).forEach((r) => r());
    this.setStatus('stopped');
    this.log('Stopped', 'user');
  }

  /** Answer the pending question / confirmation / permission prompt. */
  respond(value: string | boolean) {
    const r = this.pendingResolver;
    this.pendingResolver = undefined;
    this.task.pending = undefined;
    if (this.task.status === 'needs_you') this.setStatus('running');
    r?.(value);
  }

  /** Follow-up instruction from the user in the same task thread. */
  async followUp(text: string): Promise<void> {
    if (!['done', 'error', 'stopped'].includes(this.task.status)) return;
    this.abort = new AbortController();
    this.log(text, 'user');
    this.messages.push({ role: 'user', content: text });
    this.setStatus('running');
    await this.loop();
  }

  // ----- main -----

  async run(): Promise<Task> {
    await this.persist(true);
    try {
      const tab = this.tabId !== undefined ? await browser.getTab(this.tabId).catch(() => undefined) : await browser.activeTab();
      this.tabId = tab?.id;
      const contacts = await load('contacts');
      const preamble = taskPreamble({
        date: new Date(),
        tab: tab?.id !== undefined ? { id: tab.id, title: tab.title ?? '', url: tab.url ?? '' } : undefined,
        dueCount: dueContacts(contacts).length,
      });
      this.messages.push({ role: 'user', content: `${preamble}\n\n${this.task.prompt}` });
      await this.loop();
    } catch (e) {
      this.fail(e);
    }
    return this.task;
  }

  private async loop(): Promise<void> {
    const settings = await load('settings');
    const playbook = await load('playbook');
    let gateway: Gateway;
    try {
      gateway = this.hooks.gateway ?? makeGateway(settings);
    } catch (e) {
      return this.fail(e);
    }
    const direct = settings.gateway.mode === 'direct' && !this.hooks.gateway;
    const tools: Anthropic.Beta.BetaToolUnion[] = [
      // Stream large tool inputs as generated on the direct (streaming) path; inputs are validated with zod before running.
      ...CUSTOM_TOOLS.map((t) => (direct ? { ...t, eager_input_streaming: true } : t)),
      ...SERVER_TOOLS,
    ];
    const system = systemPrompt(settings, playbook);
    const ctx = this.toolContext(settings);
    await browser.setBanner(this.tabId, true, 'working');

    try {
      for (let turn = 0; turn < MAX_TURNS; turn++) {
        await this.waitIfPaused();
        if (this.abort.signal.aborted) return;

        const params: MessageParams = {
          model: settings.gateway.model,
          // Streaming (direct) gets more room; the non-streaming backend path stays under SDK request timeouts.
          max_tokens: direct ? 32000 : 16000,
          system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
          tools,
          messages: this.messages,
          thinking: { type: 'adaptive', display: 'updates' },
          output_config: { effort: settings.gateway.effort },
          fallbacks: 'default',
          cache_control: { type: 'ephemeral' },
        };

        let message: Anthropic.Beta.BetaMessage;
        try {
          message = await gateway.create(params, { signal: this.abort.signal });
        } catch (e) {
          if (this.abort.signal.aborted) return;
          // Eager input streaming can produce unparseable tool JSON; re-issue that turn once.
          if (e instanceof SyntaxError && turn < MAX_TURNS - 1) {
            this.log('Retrying a garbled step', 'note');
            continue;
          }
          throw e;
        }
        this.addUsage(settings.gateway.model, message);
        this.messages.push({ role: 'assistant', content: message.content as Anthropic.Beta.BetaContentBlockParam[] });

        for (const block of message.content) {
          if (block.type === 'thinking' && block.thinking.trim()) this.log(block.thinking.trim(), 'agent');
        }
        const text = message.content
          .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('\n')
          .trim();

        if (message.stop_reason === 'refusal') {
          this.log('The model declined this task.', 'error');
          return this.finish('error', text || 'The model declined this request.');
        }
        if (message.stop_reason === 'pause_turn') continue;

        const toolUses = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
        if (message.stop_reason === 'max_tokens' && toolUses.length) {
          // A cut-off tool call may hold truncated input; don't run it.
          this.messages.push({
            role: 'user',
            content: toolUses.map((t) => ({ type: 'tool_result' as const, tool_use_id: t.id, is_error: true, content: 'Your output was cut off. Make smaller steps.' })),
          });
          continue;
        }
        if (!toolUses.length) return this.finish('done', text);

        // Run sequentially: browser actions depend on each other's results.
        const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
        for (const tu of toolUses) {
          if (this.abort.signal.aborted) {
            results.push({ type: 'tool_result', tool_use_id: tu.id, is_error: true, content: 'Stopped by the user.' });
            continue;
          }
          await this.waitIfPaused();
          try {
            const content = await runTool(tu.name, tu.input, ctx);
            results.push({ type: 'tool_result', tool_use_id: tu.id, content });
          } catch (e) {
            const msg = e instanceof ToolError || e instanceof BrowserError ? e.message : `Tool failed: ${e instanceof Error ? e.message : String(e)}`;
            if (!(e instanceof ToolError)) this.log(msg, 'error');
            results.push({ type: 'tool_result', tool_use_id: tu.id, is_error: true, content: msg });
          }
        }
        this.messages.push({ role: 'user', content: results });
        if (this.abort.signal.aborted) return;
      }
      this.finish('error', `Stopped after ${MAX_TURNS} steps without finishing. Try a smaller task.`);
    } catch (e) {
      this.fail(e);
    } finally {
      await browser.setBanner(this.tabId, false);
    }
  }

  private toolContext(settings: Awaited<ReturnType<typeof load<'settings'>>>): ToolContext {
    return {
      taskId: this.task.id,
      settings,
      signal: this.abort.signal,
      getTab: () => this.tabId,
      setTab: (id) => {
        const prev = this.tabId;
        this.tabId = id;
        if (prev !== id) {
          browser.setBanner(prev, false);
          browser.setBanner(id, true, 'working');
        }
      },
      log: (text, kind = 'action') => {
        this.log(text, kind);
        if (kind === 'action') browser.setBanner(this.tabId, true, text);
      },
      setPlan: (steps: PlanStep[]) => {
        this.task.plan = steps;
        this.emit();
      },
      confirm: async (text) => {
        if (this.opts.preApproved) return true;
        return (await this.waitForUser({ id: uid('q_'), kind: 'confirm', text })) === true;
      },
      ask: async (question) => {
        const v = await this.waitForUser({ id: uid('q_'), kind: 'question', text: question });
        return typeof v === 'string' ? v : v ? 'yes' : 'no';
      },
      requestAccess: async (origin, host) =>
        (await this.waitForUser({ id: uid('q_'), kind: 'permission', text: `Allow AirDial Agent to read and act on ${host}?`, origin })) === true,
      queueDraft: this.hooks.queueDraft,
    };
  }

  private waitForUser(q: PendingQuestion): Promise<string | boolean> {
    if (this.abort.signal.aborted) return Promise.resolve(false);
    this.task.pending = q;
    this.setStatus('needs_you');
    return new Promise((resolve) => {
      this.pendingResolver = resolve;
    });
  }

  private waitIfPaused(): Promise<void> {
    if (!this.paused) return Promise.resolve();
    return new Promise((r) => this.resumeWaiters.push(r));
  }

  private addUsage(model: string, m: Anthropic.Beta.BetaMessage) {
    const u = this.task.usage!;
    u.inputTokens += m.usage.input_tokens + (m.usage.cache_read_input_tokens ?? 0) + (m.usage.cache_creation_input_tokens ?? 0);
    u.outputTokens += m.usage.output_tokens;
    u.costUsd += costOf(model, m.usage);
  }

  private log(text: string, kind: TaskLogLine['kind'] = 'action') {
    this.task.log.push({ at: nowIso(), kind, text: text.length > 400 ? text.slice(0, 400) + '…' : text });
    this.emit();
  }

  private setStatus(s: TaskStatus) {
    this.task.status = s;
    this.emit();
  }

  private finish(status: TaskStatus, result: string) {
    if (this.task.status === 'stopped') return;
    this.task.result = result;
    this.task.pending = undefined;
    if (status === 'done') this.task.plan = this.task.plan.map((p) => ({ ...p, done: true }));
    this.setStatus(status);
    this.persist(true);
  }

  private fail(e: unknown) {
    if (this.abort.signal.aborted) return;
    const msg = e instanceof GatewayConfigError ? e.message : describeError(e);
    this.log(msg, 'error');
    this.finish('error', msg);
  }

  private emit() {
    this.listeners.forEach((l) => l(this.task));
    this.persist(false);
  }

  private persist(now: boolean): Promise<unknown> {
    clearTimeout(this.saveTimer);
    const write = () => update('tasks', (tasks) => [...tasks.filter((t) => t.id !== this.task.id), structuredClone(this.task)]);
    if (now) return write();
    this.saveTimer = setTimeout(write, 250);
    return Promise.resolve();
  }
}

function describeError(e: unknown): string {
  const err = e as { status?: number; message?: string };
  if (err?.status === 401) return 'The model key was rejected. Check Settings.';
  if (err?.status === 429) return 'Rate limited by the model provider. Try again in a minute.';
  if (err?.status && err.status >= 500) return 'The model provider is having trouble. Try again shortly.';
  return err?.message ?? String(e);
}
