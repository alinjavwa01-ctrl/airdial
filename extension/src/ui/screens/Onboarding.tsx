import { useEffect, useState } from 'react';
import { useStored } from '../../store/storage';
import type { Settings } from '../../store/types';
import { AirDialSignIn } from './Settings';

function AllSites() {
  const [all, setAll] = useState(false);
  useEffect(() => {
    chrome.permissions.contains({ origins: ['<all_urls>'] }).then(setAll);
  }, []);
  return (
    <label className="toggle">
      <span>
        Allow on all sites
        <div className="meta">Best for research and everyday tasks. Turn off any time in Settings.</div>
      </span>
      <input
        type="checkbox"
        className="switch"
        checked={all}
        onChange={async (e) => {
          if (e.target.checked) setAll(await chrome.permissions.request({ origins: ['<all_urls>'] }));
          else {
            await chrome.permissions.remove({ origins: ['<all_urls>'] }).catch(() => false);
            setAll(false);
          }
        }}
      />
    </label>
  );
}

export function Onboarding() {
  const [settings, setSettings] = useStored('settings');
  const [pb, setPb] = useStored('playbook');
  const [step, setStep] = useState(0);
  const set = (patch: (s: Settings) => Partial<Settings>) => setSettings((s) => ({ ...s, ...patch(s) }));
  const connected = settings.gateway.mode === 'direct' ? !!settings.gateway.apiKey : !!settings.gateway.backendToken || !!settings.gateway.session;

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
      <h2 style={{ margin: 0 }}>Sign in to AirDial</h2>
      <div className="meta">AirDial Agent runs on your AirDial account. Usage is part of your plan.</div>
      <AirDialSignIn settings={settings} set={set} />
    </>,
    <>
      <h2 style={{ margin: 0 }}>Where I can work</h2>
      <div className="meta">
        I use your Chrome the way you do: I read pages, click, type and switch tabs, with real mouse and keyboard input. I only work on sites you allow. I'll ask the first time I need a site, or you can let me work everywhere.
      </div>
      <AllSites />
      <div className="meta">While I'm working, Chrome shows a "started debugging this browser" bar. That's me using the mouse and keyboard; it goes away when I finish.</div>
      <div className="meta">I never type passwords or card numbers, move money, delete chats or accept terms. Anything sent in your name waits for your approval.</div>
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
