// DOM reading and acting helpers used by the content script.
// Text first: the agent sees page text plus a numbered list of interactive
// elements, and only asks for a screenshot when that isn't enough.

import type { PageElement, Snapshot } from './protocol';

const REF_ATTR = 'data-airdial-ref';
let refCounter = 0;

const INTERACTIVE = [
  'a[href]',
  'button',
  'input:not([type=hidden])',
  'textarea',
  'select',
  'summary',
  '[role=button]',
  '[role=link]',
  '[role=tab]',
  '[role=menuitem]',
  '[role=option]',
  '[role=checkbox]',
  '[role=radio]',
  '[role=switch]',
  '[role=textbox]',
  '[role=combobox]',
  '[role=listitem][tabindex]',
  '[role=row][tabindex]',
  '[contenteditable=true]',
  '[contenteditable=""]',
].join(',');

const SENSITIVE_AUTOCOMPLETE = /cc-|card|cvc|csc|current-password|new-password|one-time-code/i;
const SENSITIVE_NAME = /pass(word|code)?|pin\b|cvv|cvc|card.?number|iban|account.?number|routing|sort.?code|otp|security.?code/i;

export function isVisible(el: Element): boolean {
  const he = el as HTMLElement;
  if (!he.isConnected) return false;
  // jsdom has no layout; treat everything as visible there.
  if (typeof he.getClientRects !== 'function' || navigator.userAgent.includes('jsdom')) return !he.hidden;
  if (he.getClientRects().length === 0) return false;
  const style = getComputedStyle(he);
  return style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) !== 0;
}

export function accessibleName(el: Element): string {
  const he = el as HTMLElement;
  const label =
    he.getAttribute('aria-label') ||
    labelledBy(he) ||
    (he as HTMLInputElement).labels?.[0]?.textContent ||
    he.getAttribute('title') ||
    he.getAttribute('placeholder') ||
    he.getAttribute('alt') ||
    he.getAttribute('data-placeholder') ||
    he.innerText ||
    he.textContent ||
    (he as HTMLInputElement).value ||
    '';
  return label.replace(/\s+/g, ' ').trim().slice(0, 120);
}

function labelledBy(el: HTMLElement): string {
  const ids = el.getAttribute('aria-labelledby');
  if (!ids) return '';
  return ids
    .split(/\s+/)
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' ');
}

export function roleOf(el: Element): string {
  const explicit = el.getAttribute('role');
  if (explicit) return explicit;
  const tag = el.tagName.toLowerCase();
  if (tag === 'a') return 'link';
  if (tag === 'button' || tag === 'summary') return 'button';
  if (tag === 'select') return 'combobox';
  if (tag === 'textarea') return 'textbox';
  if (tag === 'input') {
    const t = (el as HTMLInputElement).type;
    if (t === 'checkbox' || t === 'radio') return t;
    if (t === 'submit' || t === 'button') return 'button';
    return 'textbox';
  }
  if ((el as HTMLElement).isContentEditable || el.getAttribute('contenteditable') !== null) return 'textbox';
  return tag;
}

export function isSensitiveField(el: Element): boolean {
  const input = el as HTMLInputElement;
  if (input.type === 'password') return true;
  const ac = el.getAttribute('autocomplete') ?? '';
  if (SENSITIVE_AUTOCOMPLETE.test(ac)) return true;
  const hint = [el.getAttribute('name'), el.getAttribute('id'), el.getAttribute('aria-label'), el.getAttribute('placeholder')].join(' ');
  return SENSITIVE_NAME.test(hint);
}

function ensureRef(el: Element): string {
  let ref = el.getAttribute(REF_ATTR);
  if (!ref) {
    ref = `e${++refCounter}`;
    el.setAttribute(REF_ATTR, ref);
  }
  return ref;
}

export function findByRef(ref: string): HTMLElement | null {
  if (!/^e\d+$/.test(ref)) return null;
  return document.querySelector<HTMLElement>(`[${REF_ATTR}="${ref}"]`);
}

export function listElements(root: ParentNode = document, query?: string, limit = 150): PageElement[] {
  const q = query?.toLowerCase().trim();
  const out: PageElement[] = [];
  for (const el of Array.from(root.querySelectorAll(INTERACTIVE))) {
    if (el.closest('#airdial-agent-banner')) continue;
    if (!isVisible(el)) continue;
    const name = accessibleName(el);
    const role = roleOf(el);
    if (!name && role !== 'textbox') continue;
    if (q && !`${name} ${role}`.toLowerCase().includes(q)) continue;
    const input = el as HTMLInputElement;
    const sensitive = role === 'textbox' && isSensitiveField(el);
    out.push({
      ref: ensureRef(el),
      role,
      name,
      tag: el.tagName.toLowerCase(),
      value: sensitive ? undefined : typeof input.value === 'string' && input.value ? input.value.slice(0, 80) : undefined,
      sensitive: sensitive || undefined,
      disabled: input.disabled || el.getAttribute('aria-disabled') === 'true' || undefined,
    });
    if (out.length >= limit) break;
  }
  return out;
}

export function pageText(maxChars = 12000): { text: string; truncated: boolean } {
  const raw = (document.body?.innerText ?? document.body?.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim();
  return raw.length > maxChars ? { text: raw.slice(0, maxChars), truncated: true } : { text: raw, truncated: false };
}

export function snapshot(site: string | null, maxChars = 12000, query?: string): Snapshot {
  const { text, truncated } = pageText(maxChars);
  return { url: location.href, title: document.title, site, text, truncated, elements: listElements(document, query) };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function clickElement(el: HTMLElement): Promise<void> {
  el.scrollIntoView?.({ block: 'center', inline: 'center' });
  await sleep(60);
  const opts: MouseEventInit = { bubbles: true, cancelable: true, view: window, button: 0 };
  el.dispatchEvent(new PointerEvent('pointerdown', opts));
  el.dispatchEvent(new MouseEvent('mousedown', opts));
  el.dispatchEvent(new PointerEvent('pointerup', opts));
  el.dispatchEvent(new MouseEvent('mouseup', opts));
  el.click();
}

/** Types text into an input, textarea or contenteditable. cps > 0 types at human pace. */
export async function typeInto(el: HTMLElement, text: string, opts: { clear?: boolean; cps?: number } = {}): Promise<void> {
  el.scrollIntoView?.({ block: 'center' });
  el.focus();
  const cps = opts.cps ?? 0;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const proto = el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    const setValue = (v: string) => {
      setter ? setter.call(el, v) : (el.value = v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    let current = opts.clear ? '' : el.value;
    if (opts.clear) setValue('');
    for (const chunk of chunks(text, cps)) {
      current += chunk;
      setValue(current);
      if (cps > 0) await sleep(jitter((chunk.length / cps) * 1000));
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }
  // contenteditable (WhatsApp Web, LinkedIn, Gmail compose). execCommand keeps
  // the editor framework's state in sync, unlike setting textContent.
  if (opts.clear) {
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    sel?.removeAllRanges();
    sel?.addRange(range);
    document.execCommand?.('delete');
  }
  placeCaretAtEnd(el);
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    for (const chunk of chunks(lines[i] ?? '', cps)) {
      const ok = document.execCommand?.('insertText', false, chunk);
      if (!ok) {
        el.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText', data: chunk, bubbles: true, cancelable: true }));
        if (!el.textContent?.endsWith(chunk)) el.append(document.createTextNode(chunk));
        el.dispatchEvent(new InputEvent('input', { inputType: 'insertText', data: chunk, bubbles: true }));
      }
      if (cps > 0) await sleep(jitter((chunk.length / cps) * 1000));
    }
    if (i < lines.length - 1) {
      // Shift+Enter is a soft line break in chat composers.
      const init: KeyboardEventInit = { key: 'Enter', code: 'Enter', shiftKey: true, bubbles: true, cancelable: true };
      el.dispatchEvent(new KeyboardEvent('keydown', init));
      document.execCommand?.('insertLineBreak');
      el.dispatchEvent(new KeyboardEvent('keyup', init));
    }
  }
}

export function pressKey(el: Element | null, key: string): void {
  const target = el ?? document.activeElement ?? document.body;
  const init: KeyboardEventInit = { key, code: key.length === 1 ? `Key${key.toUpperCase()}` : key, bubbles: true, cancelable: true };
  target.dispatchEvent(new KeyboardEvent('keydown', init));
  target.dispatchEvent(new KeyboardEvent('keypress', init));
  target.dispatchEvent(new KeyboardEvent('keyup', init));
  if (key === 'Enter' && target instanceof HTMLInputElement && target.form) target.form.requestSubmit();
}

function placeCaretAtEnd(el: HTMLElement) {
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

function chunks(text: string, cps: number): string[] {
  if (cps <= 0) return [text];
  // Words at a time reads as human typing without one event per character.
  return text.match(/\S+\s*|\s+/g) ?? [text];
}

function jitter(ms: number): number {
  return ms * (0.7 + Math.random() * 0.6);
}

export function waitFor<T>(fn: () => T | null | undefined, timeoutMs = 5000, intervalMs = 100): Promise<T | null> {
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      const v = fn();
      if (v) return resolve(v);
      if (Date.now() - start > timeoutMs) return resolve(null);
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}

export { sleep };
