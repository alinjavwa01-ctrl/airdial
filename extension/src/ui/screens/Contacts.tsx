import { useState } from 'react';
import { Header, type Go } from '../App';
import { BackIcon } from '../components/icons';
import { todayLocal, update, useStored } from '../../store/storage';
import { startTask } from '../../agent/runtime';
import type { Contact, Stage } from '../../store/types';

const STAGES: Stage[] = ['new', 'qualifying', 'quoted', 'negotiating', 'won', 'customer', 'lost'];

export function Contacts({ go, id }: { go: Go; id?: string }) {
  const [contacts] = useStored('contacts');
  const [q, setQ] = useState('');
  const selected = id ? contacts.find((c) => c.id === id) : undefined;
  if (selected) return <ContactCard c={selected} go={go} />;

  const list = contacts
    .filter((c) => !q || `${c.name} ${c.notes} ${c.handle}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => (a.nextDate || '9999').localeCompare(b.nextDate || '9999') || b.updatedAt.localeCompare(a.updatedAt));

  return (
    <>
      <Header title="Contacts" />
      <main className="main stack">
        <input className="input" placeholder="Search contacts" aria-label="Search contacts" value={q} onChange={(e) => setQ(e.target.value)} />
        {contacts.length === 0 ? (
          <div className="empty">
            <div className="art" aria-hidden />
            <h2>No contacts yet</h2>
            <div>As the agent reads your conversations it remembers who each person is, what was said and what's next.</div>
          </div>
        ) : (
          <div className="list">
            {list.map((c) => (
              <button key={c.id} className="item" onClick={() => go({ name: 'contacts', id: c.id })}>
                <span className="grow">
                  <span className="row">
                    <strong className="grow ellipsis">{c.name}</strong>
                    <span className="chip">{c.stage}</span>
                  </span>
                  <span className="meta ellipsis" style={{ display: 'block' }}>
                    {c.nextDate ? `${c.nextDate <= todayLocal() ? 'Due' : 'Next'} ${c.nextDate}: ${c.nextStep || 'follow up'}` : c.lastTheySaid || c.notes || c.channel}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
      </main>
    </>
  );
}

function ContactCard({ c, go }: { c: Contact; go: Go }) {
  const set = (patch: Partial<Contact>) => update('contacts', (list) => list.map((x) => (x.id === c.id ? { ...x, ...patch, updatedAt: new Date().toISOString() } : x)));
  const message = () => {
    const r = startTask(`Draft the next message to ${c.name} (${c.channel}${c.handle ? `, ${c.handle}` : ''}). Read our latest conversation first if it's open or you can open it, then queue the draft for my approval. Next step on file: ${c.nextStep || 'none'}.`);
    go({ name: 'task', id: r.task.id });
  };

  return (
    <>
      <Header
        title={c.name}
        left={
          <button className="iconbtn" aria-label="Back" onClick={() => go({ name: 'contacts' })}>
            <BackIcon />
          </button>
        }
        right={<button className="btn primary small" onClick={message}>Message</button>}
      />
      <main className="main stack">
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <span className="chip">{c.channel}</span>
          {c.handle && <span className="chip ellipsis" style={{ maxWidth: 200 }}>{c.handle}</span>}
          {c.language && <span className="chip">{c.language}</span>}
          {c.cashExpected && <span className="chip">{c.cashExpected.currency} {c.cashExpected.amount.toLocaleString()} expected</span>}
        </div>
        <label className="field">
          Stage
          <select className="input" value={c.stage} onChange={(e) => set({ stage: e.target.value as Stage })}>
            {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <div className="card stack" style={{ gap: 8 }}>
          <div><div className="meta">What they said</div>{c.lastTheySaid || '—'}</div>
          <div><div className="meta">What we asked</div>{c.lastWeAsked || '—'}</div>
        </div>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <label className="field grow">
            Next step
            <input className="input" value={c.nextStep} onChange={(e) => set({ nextStep: e.target.value })} />
          </label>
          <label className="field" style={{ width: 150 }}>
            Date
            <input className="input" type="date" value={c.nextDate} onChange={(e) => set({ nextDate: e.target.value })} />
          </label>
        </div>
        <label className="field">
          Notes
          <textarea className="input" value={c.notes} onChange={(e) => set({ notes: e.target.value })} />
        </label>
        {c.history.length > 0 && (
          <section className="stack">
            <div className="section-title">History</div>
            <div className="log">
              {[...c.history].reverse().map((h, i) => (
                <div key={i} className="line">
                  <span className="dot" />
                  <span className="grow">{h.summary}<div className="meta">{new Date(h.at).toLocaleString()}</div></span>
                </div>
              ))}
            </div>
          </section>
        )}
        <div>
          <button className="btn danger small" onClick={() => { update('contacts', (l) => l.filter((x) => x.id !== c.id)); go({ name: 'contacts' }); }}>
            Delete this contact's memory
          </button>
        </div>
      </main>
    </>
  );
}
