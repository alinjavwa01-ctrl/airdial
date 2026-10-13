// Pushes contacts, approvals and the audit log to the AirDial backend, which
// is the system of record for communication management. Local storage stays
// the working copy so the panel works offline. Only runs on an AirDial account.

import { load, save } from './storage';
import { airdialToken } from '../auth/session';

let timer: ReturnType<typeof setTimeout> | undefined;
let running = false;

function hash(o: unknown): string {
  const s = JSON.stringify(o);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return String(h);
}

export function scheduleSync(delayMs = 2000) {
  clearTimeout(timer);
  timer = setTimeout(() => void syncNow(), delayMs);
}

export async function syncNow(): Promise<void> {
  if (running) return scheduleSync();
  running = true;
  try {
    const settings = await load('settings');
    const g = settings.gateway;
    if (g.mode !== 'airdial' || (!g.backendToken && !g.session) || !g.backendUrl) return;
    const token = await airdialToken();
    const [contacts, approvals, audit, state] = await Promise.all([load('contacts'), load('approvals'), load('audit'), load('sync')]);

    const hashes: Record<string, string> = {};
    const changedContacts = contacts.filter((c) => (hashes[`c:${c.id}`] = hash(c)) !== state.hashes[`c:${c.id}`]);
    const changedApprovals = approvals.filter((a) => (hashes[`m:${a.id}`] = hash(a)) !== state.hashes[`m:${a.id}`]);
    const deletedContactIds = Object.keys(state.hashes)
      .filter((k) => k.startsWith('c:') && !(k in hashes))
      .map((k) => k.slice(2));
    const newAudit = audit.filter((e) => e.at > state.auditAt).slice(0, 1000);
    if (!changedContacts.length && !changedApprovals.length && !deletedContactIds.length && !newAudit.length) return;

    const res = await fetch(`${g.backendUrl.replace(/\/$/, '')}/v1/sync`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-api-key': token },
      body: JSON.stringify({ contacts: changedContacts, approvals: changedApprovals, audit: newAudit, deletedContactIds }),
    });
    if (!res.ok) throw new Error(`sync ${res.status}`);
    await save('sync', { hashes, auditAt: newAudit.at(-1)?.at ?? state.auditAt });
    if (newAudit.length === 1000) scheduleSync(500);
  } catch {
    scheduleSync(60_000); // offline or backend down: retry later
  } finally {
    running = false;
  }
}
