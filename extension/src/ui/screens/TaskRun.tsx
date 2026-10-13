import { useEffect, useRef, useState } from 'react';
import { Header, type Go } from '../App';
import { Composer } from '../components/Composer';
import { BackIcon, PauseIcon, PlayIcon, StopIcon } from '../components/icons';
import { getRunner, startTask, useTask } from '../../agent/runtime';
import { requestAccess } from '../../browser/bridge';
import type { PendingQuestion, Task } from '../../store/types';

const STATUS: Record<Task['status'], string> = {
  running: 'Working',
  paused: 'Paused',
  needs_you: 'Needs you',
  done: 'Done',
  error: 'Stopped with a problem',
  stopped: 'Stopped',
};

export function TaskRun({ id, go }: { id: string; go: Go }) {
  const task = useTask(id);
  const runner = getRunner(id);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [task?.log.length, task?.status, task?.pending?.id]);

  if (!task) return <main className="main"><div className="meta">Loading…</div></main>;
  const live = !!runner && ['running', 'paused', 'needs_you'].includes(task.status);
  const finished = ['done', 'error', 'stopped'].includes(task.status);

  return (
    <>
      <Header
        title={task.prompt}
        left={
          <button className="iconbtn" aria-label="Back" onClick={() => go({ name: 'home' })}>
            <BackIcon />
          </button>
        }
        right={
          live ? (
            <div className="row" style={{ gap: 2 }}>
              {task.status === 'paused' ? (
                <button className="iconbtn" aria-label="Resume" title="Resume" onClick={() => runner!.resume()}>
                  <PlayIcon />
                </button>
              ) : (
                <button className="iconbtn" aria-label="Pause" title="Pause" onClick={() => runner!.pause()}>
                  <PauseIcon />
                </button>
              )}
              <button className="iconbtn" aria-label="Stop" title="Stop" onClick={() => runner!.stop()}>
                <StopIcon />
              </button>
            </div>
          ) : undefined
        }
      />
      <main className="main stack">
        <div className="bubble">{task.prompt}</div>
        <div className="status" role="status">
          {task.status === 'running' && <span className="pulse" />}
          {STATUS[task.status]}
          {task.usage && task.usage.costUsd > 0 && <span>· ${task.usage.costUsd.toFixed(3)}</span>}
        </div>

        {task.plan.length > 0 && (
          <section className="card">
            <ul className="plan" aria-label="Plan">
              {task.plan.map((s, i) => (
                <li key={i}>
                  <span className={`check ${s.done ? 'done' : ''}`} aria-hidden />
                  <span style={{ color: s.done ? 'var(--muted)' : undefined }}>{s.text}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="log" aria-label="Action log" aria-live="polite">
          {task.log.map((l, i) =>
            l.kind === 'user' && i > 0 && !['Paused', 'Resumed', 'Stopped'].includes(l.text) ? (
              <div key={i} className="bubble">{l.text}</div>
            ) : (
              <div key={i} className={`line ${l.kind}`}>
                {l.kind === 'action' && <span className="dot" />}
                <span className="grow">{l.text}</span>
              </div>
            ),
          )}
        </section>

        {task.pending && runner && <PendingCard q={task.pending} onAnswer={(v) => runner.respond(v)} />}
        {task.pending && !runner && <div className="meta">This task was interrupted when the panel closed. Start it again.</div>}

        {finished && task.result && (
          <section className={`card ${task.status === 'error' ? '' : ''}`}>
            <div className="result">{task.result}</div>
          </section>
        )}
        {finished && task.status !== 'done' && (
          <div>
            <button className="btn small" onClick={() => go({ name: 'task', id: startTask(task.prompt).task.id })}>Try again</button>
          </div>
        )}
        <div ref={endRef} />
      </main>
      {finished && runner && <Composer placeholder="Reply or add instructions" onSubmit={(t) => runner.followUp(t)} />}
    </>
  );
}

function PendingCard({ q, onAnswer }: { q: PendingQuestion; onAnswer: (v: string | boolean) => void }) {
  const [text, setText] = useState('');

  if (q.kind === 'confirm') {
    return (
      <section className="card needs stack" style={{ gap: 8 }} aria-live="assertive">
        <div className="meta">Approve this action?</div>
        <div style={{ fontWeight: 600 }}>{q.text}</div>
        <div className="row">
          <button className="btn accent" autoFocus onClick={() => onAnswer(true)}>Allow</button>
          <button className="btn" onClick={() => onAnswer(false)}>Deny</button>
        </div>
      </section>
    );
  }
  if (q.kind === 'permission') {
    return (
      <section className="card needs stack" style={{ gap: 8 }} aria-live="assertive">
        <div style={{ fontWeight: 600 }}>{q.text}</div>
        <div className="meta">The agent only works on sites you allow. You can remove access any time in Settings.</div>
        <div className="row">
          <button className="btn accent" autoFocus onClick={async () => onAnswer(await requestAccess(q.origin!))}>Allow this site</button>
          <button className="btn" onClick={() => onAnswer(false)}>Not now</button>
        </div>
      </section>
    );
  }
  return (
    <section className="card needs stack" style={{ gap: 8 }} aria-live="assertive">
      <div style={{ fontWeight: 600, whiteSpace: 'pre-wrap' }}>{q.text}</div>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) onAnswer(text.trim());
        }}
      >
        <input className="input grow" autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="Your answer" aria-label="Your answer" />
        <button className="btn accent" type="submit" disabled={!text.trim()}>Send</button>
      </form>
    </section>
  );
}
