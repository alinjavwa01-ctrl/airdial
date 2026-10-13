// Sends approved messages. Three paths, in order of preference:
//  1. AirDial WhatsApp Business API (backend) when the user's number is on it.
//  2. A built-in site sender (WhatsApp Web, LinkedIn) that types at human pace.
//  3. Anything else: a short browser-agent task with this one send pre-approved.
// Pacing applies to all of them: bursts get numbers logged out or banned.

import * as browser from '../browser/bridge';
import { contactKey, load, nowIso, todayLocal, uid, update } from '../store/storage';
import type { Approval, Contact, SendRecord, Settings } from '../store/types';

export interface PaceDecision {
  ok: boolean;
  waitSec?: number;
  reason?: string;
}

export function checkPacing(a: Pick<Approval, 'channel' | 'contactName'>, sends: SendRecord[], settings: Settings, now = new Date()): PaceDecision {
  const key = contactKey({ channel: a.channel, name: a.contactName });
  const today = todayLocal(now);
  const mine = sends.filter((s) => s.contactKey === key);
  const sentToday = mine.filter((s) => todayLocal(new Date(s.at)) === today).length;
  if (sentToday >= settings.pacing.dailyCapPerContact) {
    return { ok: false, reason: `Daily cap reached: ${sentToday} messages to ${a.contactName} today.` };
  }
  if (mine.length === 0) {
    // New contact: space these out across all contacts.
    const firstSends = new Map<string, string>();
    for (const s of sends) if (!firstSends.has(s.contactKey)) firstSends.set(s.contactKey, s.at);
    const lastNew = [...firstSends.values()].sort().pop();
    if (lastNew) {
      const elapsed = (now.getTime() - new Date(lastNew).getTime()) / 1000;
      const gap = settings.pacing.newNumberGapSec;
      if (elapsed < gap) return { ok: false, waitSec: Math.ceil(gap - elapsed), reason: `Pacing: one new contact every ${gap / 60} min.` };
    }
  }
  return { ok: true };
}

export type BrowserTaskSender = (prompt: string, sourceUrl?: string) => Promise<{ ok: boolean; result?: string }>;

const SITE_HOSTS: Record<string, { host: string; url: string; action: string }> = {
  whatsapp: { host: 'web.whatsapp.com', url: 'https://web.whatsapp.com/', action: 'whatsapp.send' },
  linkedin: { host: 'www.linkedin.com', url: 'https://www.linkedin.com/messaging/', action: 'linkedin.send' },
};

async function tabFor(host: string, url: string): Promise<number> {
  const tabs = await chrome.tabs.query({});
  const existing = tabs.find((t) => browser.hostOf(t.url) === host);
  if (existing?.id !== undefined) return existing.id;
  const tab = await chrome.tabs.create({ url, active: false });
  await browser.waitForLoad(tab.id!);
  await new Promise((r) => setTimeout(r, 3000));
  return tab.id!;
}

async function sendViaApi(a: Approval, contact: Contact | undefined, settings: Settings): Promise<void> {
  const to = contact?.handle?.replace(/[^\d+]/g, '');
  if (!to) throw new Error(`No phone number saved for ${a.contactName}, so the AirDial API can't reach them.`);
  const res = await fetch(`${settings.gateway.backendUrl.replace(/\/$/, '')}/v1/whatsapp/send`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': settings.gateway.backendToken },
    body: JSON.stringify({ to, text: a.draft, kind: a.kind }),
  });
  if (!res.ok) throw new Error(`AirDial API send failed: ${(await res.text()).slice(0, 200)}`);
}

export async function sendApproval(a: Approval, runBrowserTask: BrowserTaskSender): Promise<void> {
  const settings = await load('settings');
  const contacts = await load('contacts');
  const contact = contacts.find((c) => c.id === a.contactId) ?? contacts.find((c) => c.name.toLowerCase() === a.contactName.toLowerCase() && c.channel === a.channel);

  // Pacing: wait out the new-contact gap; refuse past the daily cap.
  for (;;) {
    const pace = checkPacing(a, await load('sends'), settings);
    if (pace.ok) break;
    if (!pace.waitSec) throw new Error(pace.reason);
    await setStatus(a.id, 'sending', `${pace.reason} Sending in ${pace.waitSec}s.`);
    await new Promise((r) => setTimeout(r, Math.min(pace.waitSec!, 30) * 1000));
  }

  if (a.channel === 'whatsapp' && settings.airdialApi.enabled && settings.gateway.backendToken) {
    await sendViaApi(a, contact, settings);
  } else if (SITE_HOSTS[a.channel]) {
    const site = SITE_HOSTS[a.channel]!;
    const tabId = await tabFor(site.host, site.url);
    await browser.call(tabId, { cmd: 'site', action: site.action, args: { name: a.contactName, text: a.draft, cps: settings.pacing.typingCps } });
  } else {
    const res = await runBrowserTask(
      `Send this exact message, already approved by the user, to ${a.contactName}${a.sourceUrl ? ` on ${a.sourceUrl}` : ''}. Do not change a word. Then confirm it was sent.\n\n<message>\n${a.draft}\n</message>`,
      a.sourceUrl,
    );
    if (!res.ok) throw new Error(res.result || 'The browser task could not send it.');
  }

  await update('sends', (s) => [...s, { contactKey: contactKey({ channel: a.channel, name: a.contactName }), at: nowIso() }]);
  await update('approvals', (list) => list.map((x) => (x.id === a.id ? { ...x, status: 'sent', sentAt: nowIso(), error: undefined } : x)));
  await update('audit', (log) => [
    ...log,
    { id: uid('a_'), at: nowIso(), taskId: a.taskId, tier: 'approve', action: 'send', label: `Sent ${a.kind.replace('_', ' ')} to ${a.contactName}`, after: a.draft, outcome: 'ok' },
  ]);
  if (contact) {
    await update('contacts', (list) =>
      list.map((c) => (c.id === contact.id ? { ...c, history: [...c.history, { at: nowIso(), summary: `We sent: ${a.draft.slice(0, 140)}` }].slice(-50), updatedAt: nowIso() } : c)),
    );
  }
}

async function setStatus(id: string, status: Approval['status'], error?: string) {
  await update('approvals', (list) => list.map((x) => (x.id === id ? { ...x, status, error } : x)));
}

// ----- one-at-a-time send queue -----

let running = false;

export async function processSendQueue(runBrowserTask: BrowserTaskSender): Promise<void> {
  if (running) return;
  running = true;
  try {
    for (;;) {
      const next = (await load('approvals')).find((a) => a.status === 'sending');
      if (!next) break;
      try {
        await sendApproval(next, runBrowserTask);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await update('approvals', (list) => list.map((x) => (x.id === next.id ? { ...x, status: 'failed', error: msg } : x)));
        await update('audit', (log) => [
          ...log,
          { id: uid('a_'), at: nowIso(), taskId: next.taskId, tier: 'approve', action: 'send', label: `Send to ${next.contactName} failed: ${msg}`, outcome: 'error' },
        ]);
      }
    }
  } finally {
    running = false;
  }
}
