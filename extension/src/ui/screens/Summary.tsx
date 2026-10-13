import { useState } from 'react';
import { Header, type Go } from '../App';
import { todayLocal, useStored } from '../../store/storage';
import type { Approval, Contact, Task } from '../../store/types';

export interface DailySummary {
  sent: number;
  sentEdited: number;
  replies: number;
  needsYou: number;
  tasks: number;
  cash: Record<string, number>;
  replyNames: string[];
  costUsd: number;
}

export function buildSummary(day: string, approvals: Approval[], contacts: Contact[], tasks: Task[]): DailySummary {
  const isDay = (iso?: string) => !!iso && todayLocal(new Date(iso)) === day;
  const sent = approvals.filter((a) => a.status === 'sent' && isDay(a.sentAt));
  // A reply = a contact whose history gained something they said today.
  const repliers = contacts.filter((c) => c.history.some((h) => isDay(h.at) && !h.summary.startsWith('We sent')));
  const cash: Record<string, number> = {};
  for (const c of contacts) {
    if (!c.cashExpected || c.stage === 'lost') continue;
    cash[c.cashExpected.currency] = (cash[c.cashExpected.currency] ?? 0) + c.cashExpected.amount;
  }
  const todaysTasks = tasks.filter((t) => isDay(t.createdAt));
  return {
    sent: sent.length,
    sentEdited: sent.filter((a) => a.edited).length,
    replies: repliers.length,
    replyNames: repliers.map((c) => c.name),
    needsYou: approvals.filter((a) => a.status === 'pending' || a.status === 'failed').length + tasks.filter((t) => t.status === 'needs_you').length,
    tasks: todaysTasks.length,
    cash,
    costUsd: todaysTasks.reduce((s, t) => s + (t.usage?.costUsd ?? 0), 0),
  };
}

export function summaryText(s: DailySummary, business: string): string {
  const cash = Object.entries(s.cash).map(([cur, n]) => `${cur} ${n.toLocaleString()}`).join(', ') || 'none logged';
  return [
    `${business || 'AirDial'} · ${new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' })}`,
    `Sent ${s.sent} message${s.sent === 1 ? '' : 's'}${s.sentEdited ? ` (${s.sentEdited} edited)` : ''}.`,
    `${s.replies} replied${s.replyNames.length ? `: ${s.replyNames.slice(0, 5).join(', ')}` : ''}.`,
    `${s.needsYou} need${s.needsYou === 1 ? 's' : ''} you.`,
    `Cash expected: ${cash}.`,
  ].join('\n');
}

export function Summary({ go }: { go: Go }) {
  const [approvals] = useStored('approvals');
  const [contacts] = useStored('contacts');
  const [tasks] = useStored('tasks');
  const [settings] = useStored('settings');
  const [copied, setCopied] = useState(false);
  const s = buildSummary(todayLocal(), approvals, contacts, tasks);
  const text = summaryText(s, settings.businessName);
  const cash = Object.entries(s.cash);

  const share = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ text });
        return;
      } catch {
        // fall through to copy
      }
    }
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <>
      <Header title="Today" right={<button className="btn small" onClick={share}>{copied ? 'Copied' : 'Share'}</button>} />
      <main className="main stack">
        <div className="kpis">
          <div className="kpi"><b>{s.sent}</b><span className="meta">sent</span></div>
          <div className="kpi"><b>{s.replies}</b><span className="meta">replied</span></div>
          <button className={`kpi ${s.needsYou ? 'needs' : ''}`} style={{ border: 0, textAlign: 'left', cursor: 'pointer' }} onClick={() => go({ name: 'approvals' })}>
            <b>{s.needsYou}</b><span className="meta">need you</span>
          </button>
          <div className="kpi">
            <b>{cash.length ? cash.map(([cur, n]) => `${cur === 'ZMW' ? 'K' : cur === 'USD' ? '$' : cur + ' '}${n.toLocaleString()}`).join(' · ') : '—'}</b>
            <span className="meta">cash expected</span>
          </div>
        </div>
        {s.replyNames.length > 0 && <div><div className="meta">Replied</div>{s.replyNames.join(', ')}</div>}
        <div className="meta">{s.tasks} task{s.tasks === 1 ? '' : 's'} today · model cost ${s.costUsd.toFixed(2)}</div>
        <div className="card result" style={{ fontSize: 14 }}>{text}</div>
      </main>
    </>
  );
}
