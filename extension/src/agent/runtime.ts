// Panel-wide registry of running tasks, plus the approval queue glue.

import { useEffect, useState } from 'react';
import { load, nowIso, uid, update } from '../store/storage';
import type { Approval, Task } from '../store/types';
import { processSendQueue, type BrowserTaskSender } from '../send/sender';
import { TaskRunner, type RunOptions } from './loop';

const runners = new Map<string, TaskRunner>();
const subscribers = new Set<() => void>();
const notify = () => subscribers.forEach((s) => s());

export function getRunner(id: string): TaskRunner | undefined {
  return runners.get(id);
}

export function activeRunners(): TaskRunner[] {
  return [...runners.values()].filter((r) => ['running', 'paused', 'needs_you'].includes(r.task.status));
}

export async function queueDraft(a: Omit<Approval, 'id' | 'createdAt' | 'status'>): Promise<string> {
  const settings = await load('settings');
  const auto = settings.autoSend[a.kind];
  const approval: Approval = { ...a, id: uid('m_'), createdAt: nowIso(), status: auto ? 'sending' : 'pending' };
  await update('approvals', (list) => [...list, approval]);
  if (auto) {
    void processSendQueue(runBrowserTask);
    return `Auto-send is on for ${a.kind.replace('_', ' ')}s, so this is being sent to ${a.contactName} with human pacing.`;
  }
  return `Queued for the user's approval. It will be sent to ${a.contactName} when they approve it.`;
}

export function startTask(prompt: string, opts: RunOptions = {}): TaskRunner {
  const runner = new TaskRunner(prompt, { queueDraft }, opts);
  runners.set(runner.task.id, runner);
  runner.onChange(notify);
  void runner.run().finally(notify);
  notify();
  return runner;
}

/** Used by the sender for channels without a built-in sender. */
export const runBrowserTask: BrowserTaskSender = async (prompt, sourceUrl) => {
  let tabId: number | undefined;
  if (sourceUrl) {
    const tabs = await chrome.tabs.query({});
    tabId = tabs.find((t) => t.url === sourceUrl)?.id ?? (await chrome.tabs.create({ url: sourceUrl, active: true })).id;
  }
  const runner = startTask(prompt, { preApproved: true, tabId });
  return new Promise((resolve) => {
    const off = runner.onChange((t) => {
      if (['done', 'error', 'stopped'].includes(t.status)) {
        off();
        resolve({ ok: t.status === 'done', result: t.result });
      }
    });
  });
};

export async function approve(ids: string[], edits: Record<string, string> = {}): Promise<void> {
  await update('approvals', (list) =>
    list.map((a) =>
      ids.includes(a.id) && (a.status === 'pending' || a.status === 'failed')
        ? { ...a, status: 'sending', error: undefined, draft: edits[a.id] ?? a.draft, edited: a.edited || (edits[a.id] !== undefined && edits[a.id] !== a.draft) }
        : a,
    ),
  );
  await update('audit', (log) => [
    ...log,
    ...ids.map((id) => ({ id: uid('a_'), at: nowIso(), tier: 'approve' as const, action: 'approve', label: `Approved message ${id}`, outcome: 'approved' as const })),
  ]);
  void processSendQueue(runBrowserTask);
}

export async function skip(ids: string[]): Promise<void> {
  await update('approvals', (list) => list.map((a) => (ids.includes(a.id) && a.status !== 'sent' ? { ...a, status: 'skipped' } : a)));
}

export function stopAll() {
  runners.forEach((r) => r.stop());
}

/** Re-renders when any runner changes; returns the live task (or the stored one). */
export function useTask(id: string | undefined): Task | undefined {
  const [, force] = useState(0);
  const [stored, setStored] = useState<Task | undefined>();
  useEffect(() => {
    const fn = () => force((n) => n + 1);
    subscribers.add(fn);
    return () => {
      subscribers.delete(fn);
    };
  }, []);
  useEffect(() => {
    if (!id || runners.has(id)) return;
    load('tasks').then((ts) => setStored(ts.find((t) => t.id === id)));
  }, [id]);
  if (!id) return undefined;
  const r = runners.get(id);
  return r ? { ...r.task } : stored;
}

export function useRunnerCount(): number {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force((n) => n + 1);
    subscribers.add(fn);
    return () => {
      subscribers.delete(fn);
    };
  }, []);
  return activeRunners().length;
}
