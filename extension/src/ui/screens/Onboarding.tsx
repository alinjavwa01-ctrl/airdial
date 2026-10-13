import { useState } from 'react';
import { useStored } from '../../store/storage';
import type { Settings } from '../../store/types';
import { ModelConnection } from './Settings';

const DEFAULT_SITES = [
  { host: 'web.whatsapp.com', label: 'WhatsApp Web', why: 'Read chats and send the replies you approve.' },
  { host: 'mail.google.com', label: 'Gmail', why: 'Read and draft email replies.' },
  { host: 'docs.google.com', label: 'Google Sheets', why: 'Log outcomes to your sheet.' },
  { host: 'www.linkedin.com', label: 'LinkedIn', why: 'Read messages and profiles.' },
];

export function Onboarding() {
  const [settings, setSettings] = useStored('settings');
  const [pb, setPb] = useStored('playbook');
  const [step, setStep] = useState(0);
  const set = (patch: (s: Settings) => Partial<Settings>) => setSettings((s) => ({ ...s, ...patch(s) }));
  const connected = settings.gateway.mode === 'direct' ? !!settings.gateway.apiKey : !!settings.gateway.backendToken;

  const steps = [
    <>
      <div className="empty" style={{ padding: '16px 0 0' }}>
        <div className="art" aria-hidden />
        <h2>Keep your conversations moving</h2>
        <div>I read the chat in front of you, draft the reply, follow up on time and keep notes. I ask before anything goes out in your name.</div>
      </div>
      <label className="field">Your name<input className="input" autoFocus value={settings.userName} onChange={(e) => set(() => ({ userName: e.target.value }))} placeholder="Njavwa" /></label>
      <label className="field">Business<input className="input" value={settings.businessName} onChange={(e) => set(() => ({ businessName: e.target.value }))} placeholder="Mutambo Beef" /></label>
    </>,
    <>
      <h2 style={{ margin: 0 }}>Connect</h2>
      <div className="meta">Sign in with your AirDial account, or use your own Anthropic key while testing.</div>
      <ModelConnection settings={settings} set={set} />
    </>,
    <>
      <h2 style={{ margin: 0 }}>Where I can work</h2>
      <div className="meta">I can read and act on these sites from the start. For any other site I'll ask you first, one site at a time.</div>
      <div className="list">
        {DEFAULT_SITES.map((s) => (
          <div key={s.host} className="item" style={{ cursor: 'default' }}>
            <span className="grow">
              <strong>{s.label}</strong>
              <div className="meta">{s.why}</div>
            </span>
          </div>
        ))}
      </div>
      <div className="meta">I never type passwords or card numbers, move money, delete chats or accept terms.</div>
    </>,
    <>
      <h2 style={{ margin: 0 }}>How you talk</h2>
      <div className="field">
        Tone
        <div className="seg" role="group" aria-label="Tone">
          {(['warm', 'direct', 'formal', 'playful'] as const).map((t) => (
            <button key={t} aria-pressed={pb.tone === t} onClick={() => setPb((p) => ({ ...p, tone: t }))}>{t}</button>
          ))}
        </div>
      </div>
      <label className="field">
        Languages your customers write in
        <input className="input" value={settings.languages.join(', ')} onChange={(e) => set(() => ({ languages: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) }))} />
      </label>
      <label className="field">
        What you sell, in a sentence
        <textarea className="input" value={pb.about} onChange={(e) => setPb((p) => ({ ...p, about: e.target.value }))} placeholder="Lusaka butcher: beef and goat, wholesale and retail." />
      </label>
      <div className="meta">Add prices and rules any time under Settings › Playbook.</div>
    </>,
  ];

  const last = step === steps.length - 1;
  const canNext = step !== 1 || connected;

  return (
    <div className="app">
      <main className="main stack" style={{ paddingTop: 20 }}>{steps[step]}</main>
      <div className="composer stack" style={{ gap: 10 }}>
        <div className="dots" aria-label={`Step ${step + 1} of ${steps.length}`}>
          {steps.map((_, i) => <span key={i} className={i === step ? 'on' : ''} />)}
        </div>
        <div className="row">
          {step > 0 && <button className="btn" onClick={() => setStep(step - 1)}>Back</button>}
          <span className="grow" />
          {step === 1 && !connected && <button className="btn ghost" onClick={() => setStep(step + 1)}>Later</button>}
          <button
            className="btn primary"
            disabled={!canNext}
            onClick={() => (last ? set(() => ({ onboarded: true })) : setStep(step + 1))}
          >
            {last ? 'Start' : 'Continue'}
          </button>
        </div>
      </div>
    </div>
  );
}
