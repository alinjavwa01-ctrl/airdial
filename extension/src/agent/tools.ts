import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import * as browser from '../browser/bridge';
import { BrowserError } from '../browser/bridge';
import type { ElementTarget, Snapshot } from '../content/protocol';
import * as cdp from '../browser/cdp';
import { load, update, uid, nowIso } from '../store/storage';
export { dueContacts } from '../store/followups';
import type { Approval, AuditEntry, Channel, Contact, MessageKind, PlanStep, Settings, Stage, Tier } from '../store/types';
import { clickTier, keyTier, textLooksSensitive, typeTier } from './safety';

type ToolResultContent = Anthropic.Beta.BetaToolResultBlockParam['content'];

export interface ToolContext {
  taskId: string;
  settings: Settings;
  signal: AbortSignal;
  getTab(): number | undefined;
  setTab(tabId: number): void;
  log(text: string, kind?: 'action' | 'note' | 'error'): void;
  setPlan(steps: PlanStep[]): void;
  /** Approve tier: shows the action in the panel and waits for Allow/Deny. */
  confirm(text: string): Promise<boolean>;
  ask(question: string): Promise<string>;
  /** Asks the user to grant access to an origin; resolves once they decide. */
  requestAccess(origin: string, host: string): Promise<boolean>;
  /** Called by draft_message; returns what happened to the draft. */
  queueDraft(a: Omit<Approval, 'id' | 'createdAt' | 'status'>): Promise<string>;
}

// ---------- tool definitions (what the model sees) ----------

const label = { type: 'string', description: 'One plain line shown to the user, e.g. "Open the pricing page".' } as const;

export const CUSTOM_TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: 'update_plan',
    description: 'Set or update the task checklist shown to the user. Call at the start of a task and whenever a step is done.',
    input_schema: {
      type: 'object',
      properties: { steps: { type: 'array', items: { type: 'object', properties: { text: { type: 'string' }, done: { type: 'boolean' } }, required: ['text', 'done'] } } },
      required: ['steps'],
    },
  },
  {
    name: 'list_tabs',
    description: 'List open tabs in the current window with their ids, titles and URLs. The tab you act on is marked "current".',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'switch_tab',
    description: 'Make another open tab the one you read and act on.',
    input_schema: { type: 'object', properties: { tab_id: { type: 'integer' }, label }, required: ['tab_id', 'label'] },
  },
  {
    name: 'open_tab',
    description: 'Open a URL in a new tab and make it the current tab.',
    input_schema: { type: 'object', properties: { url: { type: 'string' }, label }, required: ['url', 'label'] },
  },
  {
    name: 'navigate',
    description: 'Load a URL in the current tab, or go "back"/"forward".',
    input_schema: { type: 'object', properties: { url: { type: 'string', description: 'A URL, or "back" / "forward".' }, label }, required: ['url', 'label'] },
  },
  {
    name: 'read_page',
    description:
      'Read the current tab as text plus a numbered list of interactive elements (refs like e12) you can click or type into. Use this before acting. Sensitive fields (passwords, card numbers) are flagged and must not be typed into.',
    input_schema: {
      type: 'object',
      properties: {
        max_chars: { type: 'integer', description: 'Max characters of page text (default 12000).' },
        elements_only: { type: 'boolean', description: 'Skip the page text and only list elements.' },
      },
    },
  },
  {
    name: 'find',
    description: 'Find interactive elements on the current tab whose label or role contains the query, e.g. "search", "message box", "next".',
    input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  },
  {
    name: 'click',
    description:
      'Click an element by ref (from read_page/find), or at x,y viewport coordinates from a screenshot. Uses real mouse input. Clicks that send, post or submit need the user\'s approval; clicks that pay, delete or accept terms are blocked.',
    input_schema: {
      type: 'object',
      properties: { ref: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' }, double: { type: 'boolean', description: 'Double-click.' }, label },
      required: ['label'],
    },
  },
  {
    name: 'hover',
    description: 'Move the mouse over an element (ref) or point (x,y), e.g. to open a menu.',
    input_schema: { type: 'object', properties: { ref: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' } } },
  },
  {
    name: 'type_text',
    description: 'Click into a text field by ref and type. Replaces existing text unless clear is false. Does not press Enter.',
    input_schema: {
      type: 'object',
      properties: { ref: { type: 'string' }, text: { type: 'string' }, clear: { type: 'boolean', description: 'Clear the field first (default true).' }, label },
      required: ['ref', 'text', 'label'],
    },
  },
  {
    name: 'select_option',
    description: 'Choose an option in a <select> dropdown by its visible text or value. For custom dropdowns, click them instead.',
    input_schema: { type: 'object', properties: { ref: { type: 'string' }, option: { type: 'string' }, label }, required: ['ref', 'option', 'label'] },
  },
  {
    name: 'press_key',
    description:
      'Press a key or combo: Enter, Escape, Tab, Backspace, ArrowDown, PageDown, "ctrl+a", "shift+Tab". With ref, the element is focused first. Enter in a text box needs approval because it usually sends or submits.',
    input_schema: { type: 'object', properties: { key: { type: 'string' }, ref: { type: 'string' }, label }, required: ['key', 'label'] },
  },
  {
    name: 'scroll',
    description: 'Scroll the page, a scrollable element (ref), or the area under x,y (from a screenshot), up or down.',
    input_schema: {
      type: 'object',
      properties: { direction: { type: 'string', enum: ['up', 'down'] }, ref: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' } },
      required: ['direction'],
    },
  },
  {
    name: 'wait',
    description: 'Wait for the page to update, up to 10 seconds.',
    input_schema: { type: 'object', properties: { seconds: { type: 'number' } }, required: ['seconds'] },
  },
  {
    name: 'screenshot',
    description: 'Screenshot the visible part of the current tab. Coordinates in it can be used with click/hover/scroll x,y. Costs more than read_page; use when layout or images matter or text reading is not enough.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'draft_message',
    description:
      'Put a message to a contact in the user\'s approval queue. This is how you send messages on the user\'s behalf. If the user turned on auto-send for this kind, it is sent with human pacing; otherwise it waits for their approval.',
    input_schema: {
      type: 'object',
      properties: {
        contact_name: { type: 'string', description: 'Exactly as shown in the chat app.' },
        channel: { type: 'string', enum: ['whatsapp', 'linkedin', 'email', 'other'] },
        kind: { type: 'string', enum: ['reply', 'follow_up', 'price_quote', 'confirmation', 'other'] },
        text: { type: 'string', description: 'The message, ready to send.' },
        their_last_message: { type: 'string', description: 'What they last said, for context on the approval card.' },
        language: { type: 'string' },
        reason: { type: 'string', description: 'One line: why this message, now.' },
      },
      required: ['contact_name', 'channel', 'kind', 'text', 'reason'],
    },
  },
  {
    name: 'save_contact',
    description: 'Create or update the memory for one contact: who they are, stage, what was said, the next step and when.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        channel: { type: 'string', enum: ['whatsapp', 'linkedin', 'email', 'other'] },
        handle: { type: 'string', description: 'Phone number, email or profile URL if known.' },
        stage: { type: 'string', enum: ['new', 'qualifying', 'quoted', 'negotiating', 'won', 'customer', 'lost'] },
        language: { type: 'string' },
        notes: { type: 'string', description: 'Durable facts: who they are, what they buy, preferences.' },
        last_they_said: { type: 'string' },
        last_we_asked: { type: 'string' },
        next_step: { type: 'string' },
        next_date: { type: 'string', description: 'YYYY-MM-DD' },
        cash_expected: { type: 'number' },
        currency: { type: 'string', description: 'e.g. ZMW, USD' },
        summary: { type: 'string', description: 'One line for the contact history, e.g. "Asked for 50 kg price; quoted K95/kg".' },
      },
      required: ['name', 'channel'],
    },
  },
  {
    name: 'find_contacts',
    description: 'Look up saved contacts by name or text, or list those with a follow-up due on or before a date.',
    input_schema: { type: 'object', properties: { query: { type: 'string' }, due_by: { type: 'string', description: 'YYYY-MM-DD' } } },
  },
  {
    name: 'ask_user',
    description: 'Ask the user a question and wait for their answer. Use for decisions, missing facts, or when you are blocked (login, captcha).',
    input_schema: { type: 'object', properties: { question: { type: 'string' } }, required: ['question'] },
  },
];

export const SERVER_TOOLS: Anthropic.Beta.BetaToolUnion[] = [
  { type: 'web_search_20260209', name: 'web_search', max_uses: 8 },
  { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 8 },
];

// ---------- input validation ----------

const Str = z.string();
const Label = z.string().default('');
const schemas = {
  update_plan: z.object({ steps: z.array(z.object({ text: Str, done: z.boolean() })) }),
  list_tabs: z.object({}).passthrough(),
  switch_tab: z.object({ tab_id: z.number().int(), label: Label }),
  open_tab: z.object({ url: Str, label: Label }),
  navigate: z.object({ url: Str, label: Label }),
  read_page: z.object({ max_chars: z.number().int().positive().max(60000).optional(), elements_only: z.boolean().optional() }),
  find: z.object({ query: Str }),
  click: z
    .object({ ref: Str.optional(), x: z.number().optional(), y: z.number().optional(), double: z.boolean().optional(), label: Label })
    .refine((v) => v.ref || (v.x !== undefined && v.y !== undefined), 'give ref, or x and y'),
  hover: z.object({ ref: Str.optional(), x: z.number().optional(), y: z.number().optional() }).refine((v) => v.ref || (v.x !== undefined && v.y !== undefined), 'give ref, or x and y'),
  type_text: z.object({ ref: Str, text: Str, clear: z.boolean().optional(), label: Label }),
  select_option: z.object({ ref: Str, option: Str, label: Label }),
  press_key: z.object({ key: Str, ref: Str.optional(), label: Label }),
  scroll: z.object({ direction: z.enum(['up', 'down']), ref: Str.optional(), x: z.number().optional(), y: z.number().optional() }),
  wait: z.object({ seconds: z.number().min(0).max(10) }),
  screenshot: z.object({}).passthrough(),
  draft_message: z.object({
    contact_name: Str.min(1),
    channel: z.enum(['whatsapp', 'linkedin', 'email', 'other']),
    kind: z.enum(['reply', 'follow_up', 'price_quote', 'confirmation', 'other']),
    text: Str.min(1),
    their_last_message: Str.optional(),
    language: Str.optional(),
    reason: Str.default(''),
  }),
  save_contact: z.object({
    name: Str.min(1),
    channel: z.enum(['whatsapp', 'linkedin', 'email', 'other']),
    handle: Str.optional(),
    stage: z.enum(['new', 'qualifying', 'quoted', 'negotiating', 'won', 'customer', 'lost']).optional(),
    language: Str.optional(),
    notes: Str.optional(),
    last_they_said: Str.optional(),
    last_we_asked: Str.optional(),
    next_step: Str.optional(),
    next_date: Str.regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    cash_expected: z.number().optional(),
    currency: Str.optional(),
    summary: Str.optional(),
  }),
  find_contacts: z.object({ query: Str.optional(), due_by: Str.optional() }),
  ask_user: z.object({ question: Str.min(1) }),
} as const;

type ToolName = keyof typeof schemas;

export class ToolError extends Error {}

// ---------- execution ----------

export async function runTool(name: string, rawInput: unknown, ctx: ToolContext): Promise<ToolResultContent> {
  const schema = schemas[name as ToolName];
  if (!schema) throw new ToolError(`Unknown tool ${name}`);
  const parsed = schema.safeParse(rawInput ?? {});
  if (!parsed.success) throw new ToolError(`Invalid input for ${name}: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
  const input = parsed.data as any;

  // One retry after the user grants site access.
  for (let attempt = 0; ; attempt++) {
    try {
      return await exec(name as ToolName, input, ctx);
    } catch (e) {
      if (e instanceof BrowserError && e.code === 'no_access' && e.origin && attempt === 0) {
        const host = browser.hostOf(e.origin.replace('/*', ''));
        const granted = await ctx.requestAccess(e.origin, host);
        if (granted) continue;
        throw new ToolError(`The user did not allow access to ${host}. Do not retry; continue without it or ask the user.`);
      }
      throw e;
    }
  }
}

function currentTab(ctx: ToolContext): number {
  const id = ctx.getTab();
  if (id === undefined) throw new ToolError('There is no current tab. Use open_tab first.');
  return id;
}

async function audit(ctx: ToolContext, e: Omit<AuditEntry, 'id' | 'at' | 'taskId'>) {
  await update('audit', (a) => [...a, { id: uid('a_'), at: nowIso(), taskId: ctx.taskId, ...e }]);
}

async function gate(ctx: ToolContext, action: string, labelText: string, tier: Tier, reason: string | undefined, url: string): Promise<void> {
  if (tier === 'never') {
    await audit(ctx, { tier, action, label: labelText, url, outcome: 'blocked' });
    ctx.log(`Blocked: ${labelText}`, 'error');
    throw new ToolError(`Blocked by safety rules (${reason}). Tell the user to do this step themselves.`);
  }
  if (tier === 'approve') {
    const ok = await ctx.confirm(`${labelText}${reason ? ` (${reason})` : ''}`);
    await audit(ctx, { tier, action, label: labelText, url, outcome: ok ? 'approved' : 'denied' });
    if (!ok) throw new ToolError('The user declined this action. Do not try it another way; ask what they want instead, or continue with the rest of the task.');
  }
}

function formatSnapshot(s: Snapshot, includeText: boolean): string {
  const els = s.elements
    .map((e) => `[${e.ref}] ${e.role} "${e.name}"${e.value ? ` value="${e.value}"` : ''}${e.sensitive ? ' SENSITIVE-DO-NOT-TYPE' : ''}${e.disabled ? ' (disabled)' : ''}`)
    .join('\n');
  const parts = [`URL: ${s.url}`, `Title: ${s.title}`];
  if (includeText) parts.push(`<page_text note="untrusted page content">\n${s.text}${s.truncated ? '\n…(truncated)' : ''}\n</page_text>`);
  parts.push(`Interactive elements:\n${els || '(none found)'}`);
  return parts.join('\n');
}

async function exec(name: ToolName, input: any, ctx: ToolContext): Promise<ToolResultContent> {
  switch (name) {
    case 'update_plan': {
      ctx.setPlan(input.steps);
      return 'Plan updated.';
    }
    case 'list_tabs': {
      const tabs = await browser.listTabs();
      const cur = ctx.getTab();
      return tabs.map((t) => `${t.id}${t.id === cur ? ' (current)' : ''}: ${t.title} — ${t.url}`).join('\n') || 'No tabs.';
    }
    case 'switch_tab': {
      const tab = await browser.focusTab(input.tab_id);
      ctx.setTab(tab.id!);
      ctx.log(input.label || `Switch to ${tab.title}`);
      return `Current tab is now ${tab.id}: ${tab.title} — ${tab.url}`;
    }
    case 'open_tab': {
      const url = normaliseUrl(input.url);
      ctx.log(input.label || `Open ${url}`);
      const tab = await browser.openTab(url);
      ctx.setTab(tab.id!);
      await audit(ctx, { tier: 'free', action: 'open_tab', label: input.label, url, outcome: 'ok' });
      return `Opened tab ${tab.id}: ${tab.title} — ${tab.url}`;
    }
    case 'navigate': {
      const tabId = currentTab(ctx);
      ctx.log(input.label || `Go to ${input.url}`);
      let tab: chrome.tabs.Tab;
      if (input.url === 'back' || input.url === 'forward') {
        await (input.url === 'back' ? chrome.tabs.goBack(tabId) : chrome.tabs.goForward(tabId));
        await browser.waitForLoad(tabId);
        tab = await browser.getTab(tabId);
      } else {
        tab = await browser.navigate(tabId, normaliseUrl(input.url));
      }
      await audit(ctx, { tier: 'free', action: 'navigate', label: input.label, url: tab.url, outcome: 'ok' });
      return `Now on: ${tab.title} — ${tab.url}`;
    }
    case 'read_page': {
      const tabId = currentTab(ctx);
      const snap = await browser.call<Snapshot>(tabId, { cmd: 'snapshot', maxChars: input.max_chars ?? 12000 });
      ctx.log(`Read ${snap.title || browser.hostOf(snap.url)}`, 'note');
      return formatSnapshot(snap, !input.elements_only);
    }
    case 'find': {
      const snap = await browser.call<Snapshot>(currentTab(ctx), { cmd: 'snapshot', maxChars: 0, query: input.query });
      return formatSnapshot(snap, false);
    }
    case 'click': {
      const tabId = currentTab(ctx);
      const t = await browser.call<ElementTarget>(tabId, { cmd: 'target', ref: input.ref, x: input.x, y: input.y });
      const { tier, reason } = clickTier(t);
      const url = (await browser.getTab(tabId)).url ?? '';
      const what = input.label || `Click "${t.name}"`;
      await gate(ctx, 'click', what, tier, reason, url);
      ctx.log(what);
      if (await cdp.ensureAttached(tabId)) await cdp.click(tabId, t.x, t.y, input.double ? 2 : 1);
      else await browser.call(tabId, { cmd: 'click', ref: t.ref! });
      if (tier === 'free') await audit(ctx, { tier, action: 'click', label: what, url, outcome: 'ok' });
      await settle(tabId);
      return `Clicked ${t.role} "${t.name}". Read the page again to see the result.`;
    }
    case 'hover': {
      const tabId = currentTab(ctx);
      const t = await browser.call<ElementTarget>(tabId, { cmd: 'target', ref: input.ref, x: input.x, y: input.y });
      if (await cdp.ensureAttached(tabId)) await cdp.mouseMove(tabId, t.x, t.y);
      else await browser.call(tabId, { cmd: 'hover', ref: t.ref! });
      await new Promise((r) => setTimeout(r, 400));
      return `Hovering over ${t.role} "${t.name}".`;
    }
    case 'type_text': {
      const tabId = currentTab(ctx);
      const t = await browser.call<ElementTarget>(tabId, { cmd: 'target', ref: input.ref });
      const url = (await browser.getTab(tabId)).url ?? '';
      const tt = typeTier(t);
      if (tt.tier === 'never' || textLooksSensitive(input.text)) {
        await gate(ctx, 'type', input.label || 'Type into a sensitive field', 'never', tt.reason ?? 'text looks like a password or card number', url);
      }
      const what = input.label || `Type into "${t.name}"`;
      ctx.log(what);
      if (await cdp.ensureAttached(tabId)) {
        // Real focus and input: click the field, optionally select all and delete, then insert the text.
        await cdp.click(tabId, t.x, t.y);
        if (input.clear ?? true) {
          await cdp.pressKey(tabId, isMac() ? 'meta+a' : 'ctrl+a');
          await cdp.pressKey(tabId, 'Backspace');
        }
        await cdp.insertText(tabId, input.text);
      } else {
        await browser.call(tabId, { cmd: 'type', ref: t.ref!, text: input.text, clear: input.clear ?? true, cps: 0 });
      }
      await audit(ctx, { tier: 'free', action: 'type', label: what, url, after: input.text.slice(0, 500), outcome: 'ok' });
      return `Typed ${input.text.length} characters into "${t.name}". It is not submitted; press Enter or click the button if that's next.`;
    }
    case 'select_option': {
      const tabId = currentTab(ctx);
      ctx.log(input.label || `Choose "${input.option}"`);
      const r = await browser.call<{ selected: string }>(tabId, { cmd: 'select', ref: input.ref, option: input.option });
      return `Selected "${r.selected}".`;
    }
    case 'press_key': {
      const tabId = currentTab(ctx);
      const el = input.ref ? await browser.call<ElementTarget>(tabId, { cmd: 'target', ref: input.ref }) : null;
      const url = (await browser.getTab(tabId)).url ?? '';
      const { tier, reason } = keyTier(input.key.split('+').pop() ?? input.key, el);
      const what = input.label || `Press ${input.key}`;
      await gate(ctx, 'key', what, tier, reason, url);
      ctx.log(what);
      if (await cdp.ensureAttached(tabId)) {
        if (el) await cdp.click(tabId, el.x, el.y);
        await cdp.pressKey(tabId, input.key);
      } else {
        await browser.call(tabId, { cmd: 'key', key: input.key, ref: el?.ref });
      }
      await settle(tabId);
      return `Pressed ${input.key}.`;
    }
    case 'scroll': {
      const tabId = currentTab(ctx);
      if (input.x !== undefined && input.y !== undefined && (await cdp.ensureAttached(tabId))) {
        await cdp.wheel(tabId, input.x, input.y, (input.direction === 'down' ? 1 : -1) * 600);
      } else {
        await browser.call(tabId, { cmd: 'scroll', direction: input.direction, ref: input.ref });
      }
      await new Promise((r) => setTimeout(r, 300));
      return `Scrolled ${input.direction}.`;
    }
    case 'wait': {
      await new Promise((r) => setTimeout(r, input.seconds * 1000));
      return `Waited ${input.seconds}s.`;
    }
    case 'screenshot': {
      const tabId = currentTab(ctx);
      await browser.ensureInjected(tabId); // also checks site access
      ctx.log('Take a screenshot', 'note');
      await browser.focusTab(tabId);
      if (await cdp.ensureAttached(tabId)) {
        const shot = await cdp.screenshot(tabId);
        return [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: shot.data } },
          { type: 'text', text: `Viewport ${shot.width}x${shot.height} CSS px. Use these coordinates with click/hover x,y.` },
        ];
      }
      const data = await browser.screenshot(tabId);
      return [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } }];
    }
    case 'draft_message': {
      if (textLooksSensitive(input.text)) throw new ToolError('This draft looks like it contains a password or card number. Rewrite it without that.');
      const tab = ctx.getTab() !== undefined ? await browser.getTab(ctx.getTab()!).catch(() => undefined) : undefined;
      const contacts = await load('contacts');
      const match = contacts.find((c) => c.name.toLowerCase() === input.contact_name.toLowerCase() && c.channel === input.channel);
      const outcome = await ctx.queueDraft({
        taskId: ctx.taskId,
        contactName: input.contact_name,
        contactId: match?.id,
        channel: input.channel as Channel,
        kind: input.kind as MessageKind,
        language: input.language,
        theirLastMessage: input.their_last_message ?? match?.lastTheySaid ?? '',
        draft: input.text,
        reason: input.reason,
        sourceUrl: tab?.url,
      });
      return outcome;
    }
    case 'save_contact': {
      const saved = await saveContact(input);
      ctx.log(`Update notes for ${saved.name}`, 'note');
      return `Saved ${saved.name} (${saved.stage}${saved.nextDate ? `, next ${saved.nextDate}: ${saved.nextStep}` : ''}).`;
    }
    case 'find_contacts': {
      const contacts = await load('contacts');
      const q = (input.query ?? '').toLowerCase();
      const res = contacts
        .filter((c) => !q || `${c.name} ${c.handle} ${c.notes} ${c.lastTheySaid}`.toLowerCase().includes(q))
        .filter((c) => !input.due_by || (c.nextDate && c.nextDate <= input.due_by && c.stage !== 'lost'))
        .slice(0, 40);
      if (!res.length) return 'No matching contacts.';
      return res
        .map((c) => `${c.name} [${c.channel}${c.handle ? ` ${c.handle}` : ''}] stage=${c.stage}${c.language ? ` lang=${c.language}` : ''}\n  they said: ${c.lastTheySaid || '-'}\n  we asked: ${c.lastWeAsked || '-'}\n  next: ${c.nextStep || '-'} ${c.nextDate || ''}\n  notes: ${c.notes || '-'}`)
        .join('\n');
    }
    case 'ask_user': {
      const answer = await ctx.ask(input.question);
      return `The user answered: ${answer}`;
    }
  }
}

async function settle(tabId: number) {
  // Clicks and keys often start a navigation; give it a moment, then wait for load.
  await new Promise((r) => setTimeout(r, 400));
  const tab = await browser.getTab(tabId).catch(() => undefined);
  if (tab?.status === 'loading') await browser.waitForLoad(tabId, 15000);
}

function isMac(): boolean {
  return /Mac/i.test(navigator.platform);
}

function normaliseUrl(url: string): string {
  const u = url.trim();
  if (/^https?:\/\//i.test(u)) return u;
  if (/^[\w-]+(\.[\w-]+)+/.test(u)) return `https://${u}`;
  return `https://www.google.com/search?q=${encodeURIComponent(u)}`;
}

export async function saveContact(input: z.infer<typeof schemas.save_contact>): Promise<Contact> {
  let saved!: Contact;
  await update('contacts', (list) => {
    const idx = list.findIndex((c) => c.name.toLowerCase() === input.name.toLowerCase() && c.channel === input.channel);
    const prev: Contact =
      idx >= 0
        ? list[idx]!
        : { id: uid('c_'), name: input.name, channel: input.channel, handle: '', stage: 'new', notes: '', lastTheySaid: '', lastWeAsked: '', nextStep: '', nextDate: '', history: [], updatedAt: nowIso() };
    saved = {
      ...prev,
      handle: input.handle ?? prev.handle,
      stage: (input.stage as Stage) ?? prev.stage,
      language: input.language ?? prev.language,
      notes: input.notes ?? prev.notes,
      lastTheySaid: input.last_they_said ?? prev.lastTheySaid,
      lastWeAsked: input.last_we_asked ?? prev.lastWeAsked,
      nextStep: input.next_step ?? prev.nextStep,
      nextDate: input.next_date ?? prev.nextDate,
      cashExpected: input.cash_expected !== undefined ? { amount: input.cash_expected, currency: input.currency ?? prev.cashExpected?.currency ?? 'ZMW' } : prev.cashExpected,
      history: input.summary ? [...prev.history, { at: nowIso(), summary: input.summary }].slice(-50) : prev.history,
      updatedAt: nowIso(),
    };
    return idx >= 0 ? list.map((c, i) => (i === idx ? saved : c)) : [...list, saved];
  });
  return saved;
}
