import { useEffect, useState } from 'react';
import { Header, type Go } from '../App';
import { Composer } from '../components/Composer';
import { useStored, todayLocal } from '../../store/storage';
import { activeRunners, startTask, useRunnerCount } from '../../agent/runtime';
import { dueContacts } from '../../agent/tools';
import { hostOf } from '../../browser/bridge';

function useActiveTab() {
  const [tab, setTab] = useState<chrome.tabs.Tab>();
  useEffect(() => {
    const refresh = () => chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(([t]) => setTab(t));
    refresh();
    const onUpd = (_id: number, info: { status?: string; title?: string }) => (info.status === 'complete' || info.title) && refresh();
    chrome.tabs.onActivated.addListener(refresh);
    chrome.tabs.onUpdated.addListener(onUpd);
    chrome.windows.onFocusChanged.addListener(refresh);
    return () => {
      chrome.tabs.onActivated.removeListener(refresh);
      chrome.tabs.onUpdated.removeListener(onUpd);
      chrome.windows.onFocusChanged.removeListener(refresh);
    };
  }, []);
  return tab;
}

function suggestionsFor(host: string): string[] {
  if (host === 'web.whatsapp.com') return ['Draft replies to my unread chats', 'Summarise this chat', 'Who needs a follow-up?'];
  if (host.endsWith('linkedin.com')) return ['Summarise this profile', 'Draft replies to unread messages'];
  if (host === 'mail.google.com') return ['Draft replies to today\'s emails', 'What needs me in my inbox?'];
  if (host) return ['Summarise this page', 'Find the contact details on this site'];
  return ['Research suppliers near me', 'Plan my follow-ups for today'];
}

export function Home({ go }: { go: Go }) {
  const [approvals] = useStored('approvals');
  const [contacts] = useStored('contacts');
  const [audit] = useStored('audit');
  const [tasks] = useStored('tasks');
  const [settings] = useStored('settings');
  useRunnerCount();
  const tab = useActiveTab();
  const host = hostOf(tab?.url);

  const pending = approvals.filter((a) => a.status === 'pending' || a.status === 'failed');
  const waitingTasks = tasks.filter((t) => t.status === 'needs_you');
  const running = activeRunners();
  const due = dueContacts(contacts, todayLocal());
  const recent = [...audit].reverse().filter((a) => a.action !== 'approve').slice(0, 5);
  const pastTasks = [...tasks].reverse().filter((t) => !running.some((r) => r.task.id === t.id)).slice(0, 5);

  const run = (prompt: string) => {
    const r = startTask(prompt);
    go({ name: 'task', id: r.task.id });
  };

  const needsCount = pending.length + waitingTasks.length;
  const greeting = settings.userName ? `Hi ${settings.userName.split(' ')[0]}` : 'AirDial Agent';

  return (
    <>
      <Header title={greeting} />
      <main className="main stack">
        {needsCount > 0 && (
          <div className="card needs">
            <div className="row">
              <div className="grow">
                <h3>{needsCount} need{needsCount === 1 ? 's' : ''} you</h3>
                <div className="meta">
                  {[pending.length && `${pending.length} message${pending.length > 1 ? 's' : ''} to approve`, waitingTasks.length && `${waitingTasks.length} question${waitingTasks.length > 1 ? 's' : ''}`]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              </div>
              <button className="btn accent small" onClick={() => (pending.length ? go({ name: 'approvals' }) : go({ name: 'task', id: waitingTasks[0]!.id }))}>
                Review
              </button>
            </div>
          </div>
        )}

        {running.length > 0 && (
          <section className="stack">
            <div className="section-title">Working now</div>
            <div className="list">
              {running.map((r) => (
                <button key={r.task.id} className="item" onClick={() => go({ name: 'task', id: r.task.id })}>
                  <span className="pulse" style={{ marginTop: 7 }} />
                  <span className="grow">
                    <span className="ellipsis" style={{ display: 'block' }}>{r.task.prompt}</span>
                    <span className="meta ellipsis" style={{ display: 'block' }}>{r.task.log.at(-1)?.text ?? 'Starting'}</span>
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}

        <section className="stack">
          <div className="row">
            <div className="section-title grow">Due today</div>
            {due.length > 1 && (
              <button className="btn ghost small" onClick={() => run(`Draft follow-ups for everyone due today (${due.map((c) => c.name).join(', ')}). Read each conversation first if you can, then queue a short nudge for each.`)}>
                Draft all
              </button>
            )}
          </div>
          {due.length === 0 ? (
            <div className="meta">Nothing due. The agent sets follow-up dates as it works.</div>
          ) : (
            <div className="list">
              {due.slice(0, 6).map((c) => (
                <button key={c.id} className="item" onClick={() => go({ name: 'contacts', id: c.id })}>
                  <span className="dot" style={{ background: c.nextDate < todayLocal() ? 'var(--accent)' : undefined }} />
                  <span className="grow">
                    <span className="ellipsis" style={{ display: 'block', fontWeight: 600 }}>{c.name}</span>
                    <span className="meta ellipsis" style={{ display: 'block' }}>{c.nextStep || 'Follow up'}{c.nextDate < todayLocal() ? ` · since ${c.nextDate}` : ''}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>

        {recent.length > 0 && (
          <section className="stack">
            <div className="section-title">Last actions</div>
            <div className="log">
              {recent.map((a) => (
                <div key={a.id} className={`line ${a.outcome === 'blocked' || a.outcome === 'error' ? 'error' : ''}`}>
                  <span className="dot" />
                  <span className="grow ellipsis">{a.outcome === 'denied' ? `You declined: ${a.label}` : a.outcome === 'blocked' ? `Blocked: ${a.label}` : a.label}</span>
                  <span className="meta">{new Date(a.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {pastTasks.length > 0 && (
          <section className="stack">
            <div className="section-title">Recent tasks</div>
            <div className="list">
              {pastTasks.map((t) => (
                <button key={t.id} className="item" onClick={() => go({ name: 'task', id: t.id })}>
                  <span className="grow">
                    <span className="ellipsis" style={{ display: 'block' }}>{t.prompt}</span>
                    <span className="meta ellipsis" style={{ display: 'block' }}>{t.result || t.status}</span>
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}

        {!running.length && !pastTasks.length && !due.length && (
          <div className="empty">
            <div className="art" aria-hidden />
            <h2>What should I do?</h2>
            <div>Ask in plain words. I'll show my plan, work in your browser, and check with you before anything goes out in your name.</div>
          </div>
        )}
      </main>
      <div className="meta" style={{ padding: '0 16px', marginBottom: -4 }}>
        {tab?.title ? <span className="chip ellipsis" style={{ maxWidth: '100%' }} title={tab.url}>On: {tab.title}</span> : null}
      </div>
      <Composer placeholder="What should I do?" onSubmit={run} suggestions={suggestionsFor(host)} />
    </>
  );
}
