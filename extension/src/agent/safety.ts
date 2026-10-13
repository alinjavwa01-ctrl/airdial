// Permission tiers from the PRD:
//   free    - read, summarise, draft, update memory. Runs without asking.
//   approve - send a message, submit a form, post, attach. Needs a tap.
//   never   - passwords, card/bank numbers, moving money, deleting chats,
//             accepting terms. Blocked; the user does it themselves.

import type { Tier } from '../store/types';

const NEVER_CLICK = [
  /\b(pay|pay now|make payment|transfer|send money|withdraw|top ?up|buy now|place order|complete (purchase|order)|checkout|confirm (payment|purchase|order))\b/i,
  /\bdelete (chat|conversation|account|message|messages|all)\b/i,
  /\b(clear chat|empty trash|deactivate|close account)\b/i,
  /\b(i agree|accept (terms|all)|agree (to|and continue))\b/i,
];

const APPROVE_CLICK = [
  /\b(send|submit|post|publish|reply|reply all|forward|comment|tweet|share|confirm|book|reserve|apply|sign ?up|register|subscribe|connect|invite|request|accept|decline|schedule|call|voice call|video call|upload|attach|save changes|update)\b/i,
];

export interface ElementInfo {
  role: string;
  name: string;
  tag: string;
  type?: string;
  form?: boolean;
  sensitive?: boolean;
}

export function clickTier(el: ElementInfo): { tier: Tier; reason?: string } {
  const name = el.name ?? '';
  if (NEVER_CLICK.some((r) => r.test(name))) return { tier: 'never', reason: `"${name}" moves money, deletes data or accepts terms` };
  if (APPROVE_CLICK.some((r) => r.test(name))) return { tier: 'approve', reason: `"${name}" acts in your name` };
  if (el.type === 'submit' || (el.tag === 'button' && el.form && (!el.type || el.type === 'submit'))) return { tier: 'approve', reason: 'submits a form' };
  return { tier: 'free' };
}

export function typeTier(el: ElementInfo): { tier: Tier; reason?: string } {
  if (el.sensitive) return { tier: 'never', reason: 'password, card or bank field' };
  return { tier: 'free' };
}

/** Enter in a text box sends in most chat apps and submits most forms. */
export function keyTier(key: string, el: ElementInfo | null): { tier: Tier; reason?: string } {
  if (key === 'Enter' && el && el.role === 'textbox') return { tier: 'approve', reason: 'Enter in a text box usually sends or submits' };
  return { tier: 'free' };
}

const CARD_CANDIDATE = /\b(?:\d[ -]?){13,19}\b/g;
const PASSWORDISH = /\b(password|passcode|pin)\s*[:=]/i;

function luhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

/** Last line of defence on text the agent wants to type. */
export function textLooksSensitive(text: string): boolean {
  if (PASSWORDISH.test(text)) return true;
  for (const m of text.match(CARD_CANDIDATE) ?? []) {
    const digits = m.replace(/\D/g, '');
    if (digits.length >= 13 && luhn(digits)) return true;
  }
  return false;
}

export function isPaymentUrl(url: string): boolean {
  return /(checkout|\/pay(ment)?s?\b|billing|bank|wallet|transfer)/i.test(url);
}
