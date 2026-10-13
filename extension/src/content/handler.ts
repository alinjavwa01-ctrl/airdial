import type { ContentCommand, ContentResponse } from './protocol';
import { clickElement, findByRef, isSensitiveField, pressKey, roleOf, accessibleName, snapshot, typeInto } from './dom';
import * as wa from './sites/whatsapp';
import * as li from './sites/linkedin';
import { SiteError } from './sites/whatsapp';

export function siteOf(host: string): 'whatsapp' | 'linkedin' | 'gmail' | null {
  if (host === 'web.whatsapp.com') return 'whatsapp';
  if (host.endsWith('linkedin.com')) return 'linkedin';
  if (host === 'mail.google.com') return 'gmail';
  return null;
}

const siteActions: Record<string, (args: Record<string, any>) => unknown> = {
  'whatsapp.status': () => wa.status(),
  'whatsapp.listChats': (a) => wa.listChats(!!a.unreadOnly, a.limit ?? 30),
  'whatsapp.readChat': (a) => (a.name ? wa.openChat(String(a.name)) : wa.readChat(a.limit ?? 30)),
  'whatsapp.send': (a) => wa.sendMessage(String(a.name), String(a.text), Number(a.cps ?? 9)),
  'linkedin.listConversations': (a) => li.listConversations(!!a.unreadOnly, a.limit ?? 30),
  'linkedin.readThread': (a) => (a.name ? li.openConversation(String(a.name)) : li.readThread(a.limit ?? 30)),
  'linkedin.send': (a) => li.sendMessage(String(a.name), String(a.text), Number(a.cps ?? 9)),
  'linkedin.readProfile': () => li.readProfile(),
};

export async function handle(msg: ContentCommand): Promise<ContentResponse> {
  try {
    return { ok: true, data: await run(msg) };
  } catch (e) {
    if (e instanceof SiteError) return { ok: false, error: e.message, code: e.code };
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function run(msg: ContentCommand): Promise<unknown> {
  switch (msg.cmd) {
    case 'ping':
      return { url: location.href, site: siteOf(location.hostname) };
    case 'snapshot':
      return snapshot(siteOf(location.hostname), msg.maxChars, msg.query);
    case 'describe': {
      const el = need(msg.ref);
      return { role: roleOf(el), name: accessibleName(el), sensitive: isSensitiveField(el), tag: el.tagName.toLowerCase(), type: (el as HTMLInputElement).type, form: !!(el as HTMLInputElement).form };
    }
    case 'click':
      await clickElement(need(msg.ref));
      return { clicked: msg.ref };
    case 'type': {
      const el = need(msg.ref);
      // Defence in depth: the panel also blocks this before it gets here.
      if (isSensitiveField(el)) throw new SiteError('blocked', 'This is a password or payment field. The agent never types there.');
      await typeInto(el, msg.text, { clear: msg.clear, cps: msg.cps });
      return { typed: msg.text.length };
    }
    case 'key':
      pressKey(msg.ref ? need(msg.ref) : null, msg.key);
      return { pressed: msg.key };
    case 'scroll': {
      const target = msg.ref ? need(msg.ref) : null;
      const dy = (msg.direction === 'down' ? 1 : -1) * Math.round(window.innerHeight * 0.8);
      if (target) target.scrollBy({ top: dy, behavior: 'instant' as ScrollBehavior });
      else window.scrollBy({ top: dy, behavior: 'instant' as ScrollBehavior });
      return { scrolled: msg.direction };
    }
    case 'banner':
      setBanner(msg.on, msg.label);
      return { banner: msg.on };
    case 'site': {
      const fn = siteActions[msg.action];
      if (!fn) throw new Error(`Unknown site action ${msg.action}`);
      return await fn(msg.args ?? {});
    }
  }
}

function need(ref: string): HTMLElement {
  const el = findByRef(ref);
  if (!el) throw new SiteError('stale_ref', `Element ${ref} is gone. Read the page again to get fresh refs.`);
  return el;
}

// Visible banner on the page whenever the agent has control (PRD: "the user
// always knows the agent has control").
function setBanner(on: boolean, label?: string) {
  let host = document.getElementById('airdial-agent-banner');
  if (!on) {
    host?.remove();
    return;
  }
  if (!host) {
    host = document.createElement('div');
    host.id = 'airdial-agent-banner';
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        .bar{position:fixed;top:10px;left:50%;transform:translateX(-50%);z-index:2147483647;display:flex;align-items:center;gap:10px;
          background:#3d0a1f;color:#fff;font:500 13px/1.3 system-ui,-apple-system,"Segoe UI",sans-serif;padding:8px 10px 8px 14px;border-radius:999px;
          box-shadow:0 6px 24px rgba(61,10,31,.35);max-width:min(560px,92vw)}
        .dot{width:8px;height:8px;border-radius:50%;background:#ff7aa9;flex:none;animation:p 1.2s ease-in-out infinite}
        @keyframes p{50%{opacity:.35}}
        .label{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        button{all:unset;cursor:pointer;background:#ff7aa9;color:#3d0a1f;font-weight:600;padding:4px 12px;border-radius:999px}
        button:focus-visible{outline:2px solid #fff}
      </style>
      <div class="bar" role="status" aria-live="polite"><span class="dot"></span><span class="label"></span><button type="button">Stop</button></div>`;
    shadow.querySelector('button')!.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'airdial-stop' }).catch(() => undefined);
      host?.remove();
    });
    document.documentElement.appendChild(host);
  }
  const labelEl = host.shadowRoot!.querySelector('.label')!;
  labelEl.textContent = `AirDial Agent: ${label ?? 'working'}`;
}
