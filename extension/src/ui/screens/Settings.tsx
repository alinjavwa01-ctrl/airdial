import { useEffect, useState } from 'react';
import { Header } from '../App';
import { useStored } from '../../store/storage';
import { MESSAGE_KINDS, type Effort, type Playbook, type Settings } from '../../store/types';

const TONES: Playbook['tone'][] = ['warm', 'direct', 'formal', 'playful'];
const EFFORTS: Effort[] = ['low', 'medium', 'high'];
const MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (best)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (faster, cheaper)' },
];

export function SettingsScreen({ section }: { section?: string }) {
  const [settings, setSettings] = useStored('settings');
  const [tab, setTab] = useState(section ?? 'agent');
  const set = (patch: (s: Settings) => Partial<Settings>) => setSettings((s) => ({ ...s, ...patch(s) }));

  return (
    <>
      <Header title="Settings" />
      <main className="main stack">
        <div className="seg" role="group" aria-label="Settings section">
          {([['agent', 'Agent'], ['playbook', 'Playbook'], ['sites', 'Sites'], ['log', 'Activity']] as const).map(([id, label]) => (
            <button key={id} aria-pressed={tab === id} onClick={() => setTab(id)}>{label}</button>
          ))}
        </div>
        {tab === 'agent' && <AgentSettings settings={settings} set={set} />}
        {tab === 'playbook' && <PlaybookEditor />}
        {tab === 'sites' && <Sites />}
        {tab === 'log' && <Activity />}
      </main>
    </>
  );
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="toggle">
      <span>
        {label}
        {hint && <div className="meta">{hint}</div>}
      </span>
      <input type="checkbox" className="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

export function ModelConnection({ settings, set }: { settings: Settings; set: (p: (s: Settings) => Partial<Settings>) => void }) {
  const g = settings.gateway;
  const setG = (patch: Partial<Settings['gateway']>) => set((s) => ({ gateway: { ...s.gateway, ...patch } }));
  return (
    <div className="stack">
      <div className="seg" role="group" aria-label="Connection">
        <button aria-pressed={g.mode === 'airdial'} onClick={() => setG({ mode: 'airdial' })}>AirDial account</button>
        <button aria-pressed={g.mode === 'direct'} onClick={() => setG({ mode: 'direct' })}>Own API key</button>
      </div>
      {g.mode === 'direct' ? (
        <label className="field">
          Anthropic API key
          <input className="input" type="password" autoComplete="off" value={g.apiKey} onChange={(e) => setG({ apiKey: e.target.value.trim() })} placeholder="sk-ant-…" />
          <span>Stored only in this browser. For testing; teams should use an AirDial account.</span>
        </label>
      ) : (
        <>
          <label className="field">
            AirDial server
            <input className="input" value={g.backendUrl} onChange={(e) => setG({ backendUrl: e.target.value.trim() })} />
          </label>
          <label className="field">
            Access token
            <input className="input" type="password" autoComplete="off" value={g.backendToken} onChange={(e) => setG({ backendToken: e.target.value.trim() })} />
          </label>
        </>
      )}
    </div>
  );
}

function AgentSettings({ settings, set }: { settings: Settings; set: (p: (s: Settings) => Partial<Settings>) => void }) {
  const setPacing = (patch: Partial<Settings['pacing']>) => set((s) => ({ pacing: { ...s.pacing, ...patch } }));
  return (
    <>
      <section className="stack">
        <div className="section-title">You</div>
        <label className="field">Your name<input className="input" value={settings.userName} onChange={(e) => set(() => ({ userName: e.target.value }))} /></label>
        <label className="field">Business<input className="input" value={settings.businessName} onChange={(e) => set(() => ({ businessName: e.target.value }))} /></label>
      </section>

      <section className="stack">
        <div className="section-title">Auto-send</div>
        <div className="meta">Everything else waits in Approve. Messages sent on their own stay quiet in the log.</div>
        <div>
          {MESSAGE_KINDS.map(({ kind, label }) => (
            <Toggle key={kind} label={label} checked={settings.autoSend[kind]} onChange={(v) => set((s) => ({ autoSend: { ...s.autoSend, [kind]: v } }))} />
          ))}
        </div>
      </section>

      <section className="stack">
        <div className="section-title">Pacing</div>
        <div className="meta">Sending in bursts gets WhatsApp numbers logged out or banned.</div>
        <label className="field">
          Minutes between messages to new contacts
          <input className="input" type="number" min={1} max={60} value={settings.pacing.newNumberGapSec / 60} onChange={(e) => setPacing({ newNumberGapSec: Math.max(1, Number(e.target.value)) * 60 })} />
        </label>
        <label className="field">
          Max messages per contact per day
          <input className="input" type="number" min={1} max={50} value={settings.pacing.dailyCapPerContact} onChange={(e) => setPacing({ dailyCapPerContact: Math.max(1, Number(e.target.value)) })} />
        </label>
        <Toggle
          label="Send WhatsApp through AirDial API"
          hint="When your number is on AirDial's WhatsApp Business API. Uses templates outside the 24-hour window."
          checked={settings.airdialApi.enabled}
          onChange={(v) => set(() => ({ airdialApi: { enabled: v } }))}
        />
      </section>

      <section className="stack">
        <div className="section-title">Languages</div>
        <label className="field">
          Languages your customers use (comma separated)
          <input className="input" value={settings.languages.join(', ')} onChange={(e) => set(() => ({ languages: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) }))} />
        </label>
        <label className="field">Default<input className="input" value={settings.defaultLanguage} onChange={(e) => set(() => ({ defaultLanguage: e.target.value }))} /></label>
        <label className="field">
          Morning follow-up reminder (hour)
          <input className="input" type="number" min={0} max={23} value={settings.morningHour} onChange={(e) => set(() => ({ morningHour: Number(e.target.value) }))} />
        </label>
      </section>

      <section className="stack">
        <div className="section-title">Model</div>
        <ModelConnection settings={settings} set={set} />
        <label className="field">
          Model
          <select className="input" value={settings.gateway.model} onChange={(e) => set((s) => ({ gateway: { ...s.gateway, model: e.target.value } }))}>
            {MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </label>
        <div className="field">
          Effort
          <div className="seg" role="group" aria-label="Effort">
            {EFFORTS.map((e) => (
              <button key={e} aria-pressed={settings.gateway.effort === e} onClick={() => set((s) => ({ gateway: { ...s.gateway, effort: e } }))}>{e}</button>
            ))}
          </div>
          <span>Higher effort is more careful on long tasks and costs more per task.</span>
        </div>
      </section>
    </>
  );
}

export function PlaybookEditor() {
  const [pb, setPb] = useStored('playbook');
  const [rule, setRule] = useState('');
  const set = (patch: Partial<Playbook>) => setPb((p) => ({ ...p, ...patch }));
  return (
    <section className="stack">
      <div className="meta">How you sell and talk. The agent applies this to every message it drafts.</div>
      <div className="field">
        Tone
        <div className="seg" role="group" aria-label="Tone">
          {TONES.map((t) => <button key={t} aria-pressed={pb.tone === t} onClick={() => set({ tone: t })}>{t}</button>)}
        </div>
      </div>
      <label className="field">About your business<textarea className="input" value={pb.about} onChange={(e) => set({ about: e.target.value })} placeholder="Lusaka butcher. Beef and goat, wholesale to restaurants and retail at the shop in Kabulonga." /></label>
      <label className="field">Prices<textarea className="input" value={pb.prices} onChange={(e) => set({ prices: e.target.value })} placeholder={'T-bone K120/kg\nMince K85/kg, K80/kg over 20 kg\nDelivery in Lusaka K50'} /></label>
      <div className="field">
        Rules
        <div className="list">
          {pb.rules.map((r, i) => (
            <div key={i} className="item" style={{ cursor: 'default' }}>
              <span className="grow">{r}</span>
              <button className="btn ghost small" aria-label={`Remove rule ${r}`} onClick={() => set({ rules: pb.rules.filter((_, j) => j !== i) })}>Remove</button>
            </div>
          ))}
        </div>
        <form className="row" onSubmit={(e) => { e.preventDefault(); if (rule.trim()) { set({ rules: [...pb.rules, rule.trim()] }); setRule(''); } }}>
          <input className="input grow" value={rule} onChange={(e) => setRule(e.target.value)} placeholder="e.g. Always confirm delivery address" aria-label="New rule" />
          <button className="btn" type="submit" disabled={!rule.trim()}>Add</button>
        </form>
      </div>
      <label className="field">Example replies in your voice<textarea className="input" value={pb.examples} onChange={(e) => set({ examples: e.target.value })} placeholder="Muli bwanji! Yes we have T-bone today, how many kg do you need?" /></label>
      <label className="field">Sign-off<input className="input" value={pb.signOff} onChange={(e) => set({ signOff: e.target.value })} /></label>
    </section>
  );
}

function Sites() {
  const [origins, setOrigins] = useState<string[]>([]);
  const [host, setHost] = useState('');
  const refresh = () => chrome.permissions.getAll().then((p) => setOrigins(p.origins ?? []));
  useEffect(() => {
    refresh();
  }, []);
  const all = origins.includes('<all_urls>');
  const add = async () => {
    const h = host.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!h) return;
    await chrome.permissions.request({ origins: [`https://${h}/*`] });
    setHost('');
    refresh();
  };
  return (
    <section className="stack">
      <div className="meta">The agent can read and act only on these sites. It asks before using a new one.</div>
      <div className="list">
        {origins.filter((o) => o !== '<all_urls>').map((o) => (
          <div key={o} className="item" style={{ cursor: 'default' }}>
            <span className="grow ellipsis">{o.replace(/^https?:\/\//, '').replace(/\/\*$/, '')}</span>
            <button className="btn ghost small" onClick={() => chrome.permissions.remove({ origins: [o] }).then(refresh, refresh)}>Remove</button>
          </div>
        ))}
      </div>
      <form className="row" onSubmit={(e) => { e.preventDefault(); add(); }}>
        <input className="input grow" value={host} onChange={(e) => setHost(e.target.value)} placeholder="example.com" aria-label="Add a site" />
        <button className="btn" type="submit">Allow</button>
      </form>
      <Toggle
        label="Allow on all sites"
        hint="Needed for screenshots and open-ended research. You can turn it off any time."
        checked={all}
        onChange={async (v) => {
          if (v) await chrome.permissions.request({ origins: ['<all_urls>'] });
          else await chrome.permissions.remove({ origins: ['<all_urls>'] }).catch(() => false);
          refresh();
        }}
      />
    </section>
  );
}

function Activity() {
  const [audit] = useStored('audit');
  const exportCsv = () => {
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = [['time', 'tier', 'action', 'label', 'outcome', 'url', 'before', 'after'], ...audit.map((a) => [a.at, a.tier, a.action, a.label, a.outcome, a.url, a.before, a.after])];
    const blob = new Blob([rows.map((r) => r.map(esc).join(',')).join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `airdial-agent-activity-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };
  return (
    <section className="stack">
      <div className="row">
        <div className="meta grow">Every action with time, page and what changed.</div>
        <button className="btn small" onClick={exportCsv} disabled={!audit.length}>Export CSV</button>
      </div>
      <div className="log">
        {[...audit].reverse().slice(0, 200).map((a) => (
          <div key={a.id} className={`line ${a.outcome === 'blocked' || a.outcome === 'error' || a.outcome === 'denied' ? 'error' : ''}`}>
            <span className="dot" />
            <span className="grow">
              {a.label}
              <div className="meta">{new Date(a.at).toLocaleString()} · {a.tier} · {a.outcome}{a.url ? ` · ${a.url.replace(/^https?:\/\//, '').slice(0, 40)}` : ''}</div>
            </span>
          </div>
        ))}
        {!audit.length && <div className="meta">Nothing yet.</div>}
      </div>
    </section>
  );
}
