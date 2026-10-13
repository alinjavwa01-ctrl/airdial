import { useEffect, useState } from 'react';
import { Header, type Go } from '../App';
import { useStored } from '../../store/storage';
import { approve, skip } from '../../agent/runtime';
import type { Approval } from '../../store/types';

const KIND: Record<Approval['kind'], string> = { reply: 'Reply', follow_up: 'Follow-up', price_quote: 'Price quote', confirmation: 'Confirmation', other: 'Message' };

export function Approvals({ go }: { go: Go }) {
  const [approvals] = useStored('approvals');
  const open = approvals.filter((a) => a.status === 'pending' || a.status === 'failed');
  const inFlight = approvals.filter((a) => a.status === 'sending');
  const recent = [...approvals].reverse().filter((a) => a.status === 'sent' || a.status === 'skipped').slice(0, 8);
  const [focus, setFocus] = useState(0);
  const [editing, setEditing] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});

  useEffect(() => {
    if (focus >= open.length) setFocus(Math.max(0, open.length - 1));
  }, [open.length, focus]);

  // Keyboard-first: Enter approves, E edits, S skips, arrows / J K move.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (editing || t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || e.metaKey || e.ctrlKey || e.altKey) return;
      const a = open[focus];
      if (!a) return;
      const k = e.key.toLowerCase();
      if (k === 'enter') {
        e.preventDefault();
        approve([a.id], edits);
      } else if (k === 'e') {
        e.preventDefault();
        setEditing(a.id);
      } else if (k === 's') {
        e.preventDefault();
        skip([a.id]);
      } else if (k === 'arrowdown' || k === 'j') {
        e.preventDefault();
        setFocus((f) => Math.min(open.length - 1, f + 1));
      } else if (k === 'arrowup' || k === 'k') {
        e.preventDefault();
        setFocus((f) => Math.max(0, f - 1));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, focus, editing, edits]);

  return (
    <>
      <Header
        title="Approve"
        right={open.length > 1 ? <button className="btn primary small" onClick={() => approve(open.map((a) => a.id), edits)}>Approve all {open.length}</button> : undefined}
      />
      <main className="main stack">
        {open.length === 0 && inFlight.length === 0 && (
          <div className="empty">
            <div className="art" aria-hidden />
            <h2>Nothing to approve</h2>
            <div>Drafts land here before anything is sent in your name.</div>
            <button className="btn" onClick={() => go({ name: 'home' })}>Give the agent a task</button>
          </div>
        )}
        {open.length > 0 && (
          <div className="meta">
            <kbd>Enter</kbd> approve · <kbd>E</kbd> edit · <kbd>S</kbd> skip · <kbd>↑</kbd><kbd>↓</kbd> move
          </div>
        )}
        {open.map((a, i) => (
          <article key={a.id} className={`approval ${i === focus ? 'focused' : ''}`} onClick={() => setFocus(i)} aria-label={`Message to ${a.contactName}`}>
            <div className="row">
              <strong className="grow ellipsis">{a.contactName}</strong>
              <span className="chip">{KIND[a.kind]}</span>
              {a.language && <span className="chip">{a.language}</span>}
            </div>
            {a.theirLastMessage && <div className="theirs">{a.theirLastMessage}</div>}
            {editing === a.id ? (
              <textarea
                className="input"
                autoFocus
                value={edits[a.id] ?? a.draft}
                onChange={(e) => setEdits({ ...edits, [a.id]: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setEditing(null);
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    setEditing(null);
                    approve([a.id], edits);
                  }
                }}
                rows={4}
                aria-label="Edit draft"
              />
            ) : (
              <div className="draft">{edits[a.id] ?? a.draft}</div>
            )}
            {a.reason && <div className="meta">{a.reason}</div>}
            {a.status === 'failed' && <div className="meta" style={{ color: 'var(--danger)' }}>Not sent: {a.error}</div>}
            <div className="row">
              <button className="btn primary small" onClick={() => { setEditing(null); approve([a.id], edits); }}>
                {a.status === 'failed' ? 'Retry' : 'Approve'}
              </button>
              <button className="btn small" onClick={() => setEditing(editing === a.id ? null : a.id)}>{editing === a.id ? 'Done' : 'Edit'}</button>
              <button className="btn ghost small" onClick={() => skip([a.id])}>Skip</button>
              <span className="grow" />
              <span className="meta">{a.channel}</span>
            </div>
          </article>
        ))}

        {inFlight.length > 0 && (
          <section className="stack">
            <div className="section-title">Sending</div>
            {inFlight.map((a) => (
              <div key={a.id} className="row">
                <span className="pulse" />
                <span className="grow ellipsis">{a.contactName}</span>
                <span className="meta ellipsis" style={{ maxWidth: '60%' }}>{a.error ?? 'Typing at human pace'}</span>
              </div>
            ))}
          </section>
        )}

        {recent.length > 0 && (
          <section className="stack">
            <div className="section-title">Recent</div>
            <div className="list">
              {recent.map((a) => (
                <div key={a.id} className="item" style={{ cursor: 'default' }}>
                  <span className="grow">
                    <span className="ellipsis" style={{ display: 'block' }}>{a.contactName}</span>
                    <span className="meta ellipsis" style={{ display: 'block' }}>{a.draft}</span>
                  </span>
                  <span className={`chip ${a.status === 'sent' ? 'ok' : ''}`}>{a.status === 'sent' ? (a.edited ? 'Sent, edited' : 'Sent') : 'Skipped'}</span>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>
    </>
  );
}
