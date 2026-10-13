import type { ContentCommand, ContentResponse, ElementTarget } from './protocol';
import { BRAND } from '../brand';
import {
  accessibleName,
  clickElement,
  ensureElementRef,
  findByRef,
  interactiveAt,
  isSensitiveField,
  pressKey,
  roleOf,
  snapshot,
  sleep,
  typeInto,
} from './dom';

export class PageError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

export async function handle(msg: ContentCommand): Promise<ContentResponse> {
  try {
    return { ok: true, data: await run(msg) };
  } catch (e) {
    if (e instanceof PageError) return { ok: false, error: e.message, code: e.code };
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function describe(el: HTMLElement) {
  return {
    role: roleOf(el),
    name: accessibleName(el),
    tag: el.tagName.toLowerCase(),
    type: (el as HTMLInputElement).type || undefined,
    form: !!(el as HTMLInputElement).form,
    sensitive: isSensitiveField(el),
    editable: el.isContentEditable || el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement,
  };
}

async function target(el: HTMLElement): Promise<ElementTarget> {
  el.scrollIntoView({ block: 'center', inline: 'center' });
  await sleep(120);
  const r = el.getBoundingClientRect();
  return { ref: ensureElementRef(el), ...describe(el), x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
}

async function run(msg: ContentCommand): Promise<unknown> {
  switch (msg.cmd) {
    case 'ping':
      return { url: location.href };
    case 'snapshot':
      return snapshot(msg.maxChars, msg.query);
    case 'describe':
      return describe(need(msg.ref));
    case 'target': {
      if (msg.ref) return target(need(msg.ref));
      if (msg.x === undefined || msg.y === undefined) throw new PageError('bad_args', 'Give a ref or x and y.');
      const el = interactiveAt(msg.x, msg.y);
      if (!el) throw new PageError('nothing_there', `Nothing at (${msg.x}, ${msg.y}).`);
      return { ref: ensureElementRef(el), ...describe(el), x: msg.x, y: msg.y };
    }
    case 'click':
      await clickElement(need(msg.ref));
      return { clicked: msg.ref };
    case 'type': {
      const el = need(msg.ref);
      // Defence in depth: the panel also blocks this before it gets here.
      if (isSensitiveField(el)) throw new PageError('blocked', 'This is a password or payment field. The agent never types there.');
      await typeInto(el, msg.text, { clear: msg.clear, cps: msg.cps });
      return { typed: msg.text.length };
    }
    case 'select': {
      const el = need(msg.ref);
      if (!(el instanceof HTMLSelectElement)) throw new PageError('not_select', 'That element is not a dropdown. Click it and pick the option instead.');
      const want = msg.option.trim().toLowerCase();
      const opt = Array.from(el.options).find((o) => o.value.toLowerCase() === want || o.text.trim().toLowerCase() === want) ??
        Array.from(el.options).find((o) => o.text.toLowerCase().includes(want));
      if (!opt) throw new PageError('no_option', `No option "${msg.option}". Options: ${Array.from(el.options).map((o) => o.text.trim()).join(', ')}`);
      el.value = opt.value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { selected: opt.text.trim() };
    }
    case 'hover': {
      const el = need(msg.ref);
      for (const type of ['pointerover', 'pointerenter', 'mouseover', 'mouseenter', 'pointermove', 'mousemove'])
        el.dispatchEvent(new MouseEvent(type, { bubbles: type.endsWith('over') || type.endsWith('move'), view: window }));
      return { hovered: msg.ref };
    }
    case 'key':
      pressKey(msg.ref ? need(msg.ref) : null, msg.key);
      return { pressed: msg.key };
    case 'scroll': {
      const t = msg.ref ? need(msg.ref) : null;
      const dy = (msg.direction === 'down' ? 1 : -1) * Math.round(window.innerHeight * 0.8);
      if (t) t.scrollBy({ top: dy, behavior: 'instant' as ScrollBehavior });
      else window.scrollBy({ top: dy, behavior: 'instant' as ScrollBehavior });
      return { scrolled: msg.direction };
    }
    case 'banner':
      setBanner(msg.on, msg.label);
      return { banner: msg.on };
  }
}

function need(ref: string): HTMLElement {
  const el = findByRef(ref);
  if (!el) throw new PageError('stale_ref', `Element ${ref} is gone. Read the page again to get fresh refs.`);
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
        .bar{position:fixed;bottom:16px;left:50%;transform:translateX(-50%);z-index:2147483647;display:flex;align-items:center;gap:10px;
          background:${BRAND.wineDeep};color:#fff;font:500 13px/1.3 system-ui,-apple-system,"Segoe UI",sans-serif;padding:8px 10px 8px 14px;border-radius:999px;
          box-shadow:0 6px 24px rgba(0,0,0,.3);max-width:min(560px,92vw);pointer-events:auto}
        .dot{width:8px;height:8px;border-radius:50%;background:${BRAND.pink};flex:none;animation:p 1.2s ease-in-out infinite}
        @keyframes p{50%{opacity:.35}}
        .label{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        button{all:unset;cursor:pointer;background:${BRAND.pink};color:${BRAND.wineDeep};font-weight:600;padding:4px 12px;border-radius:999px}
        button:focus-visible{outline:2px solid #fff}
      </style>
      <div class="bar" role="status" aria-live="polite"><span class="dot"></span><span class="label"></span><button type="button">Stop</button></div>`;
    shadow.querySelector('button')!.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'airdial-stop' }).catch(() => undefined);
      host?.remove();
    });
    document.documentElement.appendChild(host);
  }
  host.shadowRoot!.querySelector('.label')!.textContent = `${BRAND.product}: ${label ?? 'working'}`;
}
