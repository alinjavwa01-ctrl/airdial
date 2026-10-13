// WhatsApp Web adapter. All selectors live in this one file so a WhatsApp
// markup change is a one-file fix. Each selector list is tried in order.

import type { ChatMessage, ChatSummary, ChatThread } from '../protocol';
import { clickElement, sleep, typeInto, waitFor } from '../dom';

export const WA = {
  loggedIn: ['#pane-side', '[data-testid="chat-list"]', '[aria-label="Chat list"]'],
  qr: ['canvas[aria-label*="Scan" i]', '[data-testid="qrcode"]', 'div[data-ref] canvas'],
  chatList: ['#pane-side [role="listitem"]', '#pane-side [role="row"]', '[aria-label="Chat list"] [role="listitem"]'],
  chatTitle: ['span[title]', 'span[dir="auto"][title]'],
  chatPreview: ['[data-testid="last-msg-status"] span[title]', 'span[dir="ltr"]', 'span[dir="auto"]:not([title])'],
  chatTime: ['div[class*="_ak8i"]', '[data-testid="cell-frame-primary-detail"]'],
  unreadBadge: ['span[aria-label*="unread" i]', '[data-testid="icon-unread-count"]'],
  openChatHeader: ['#main header span[title]', '#main header span[dir="auto"]', '#main header [data-testid="conversation-info-header-chat-title"]'],
  messageRows: ['#main [role="row"]', '#main div.message-in, #main div.message-out', '#main [data-id]'],
  messageMeta: ['[data-pre-plain-text]'],
  messageText: ['span.selectable-text', '[data-testid="selectable-text"]', 'span[dir="ltr"]', 'span[dir="auto"]'],
  composer: ['#main footer div[contenteditable="true"]', 'footer div[contenteditable="true"][role="textbox"]', '#main div[contenteditable="true"][data-tab="10"]'],
  sendButton: ['#main footer button[aria-label="Send" i]', '#main footer span[data-icon="send"]', '#main footer span[data-icon="wds-ic-send-filled"]', 'button[data-testid="compose-btn-send"]'],
  searchBox: ['#side div[contenteditable="true"]', 'div[contenteditable="true"][aria-label*="Search" i]', '[data-testid="chat-list-search"]'],
};

function q<T extends Element = HTMLElement>(sels: string[], root: ParentNode = document): T | null {
  for (const s of sels) {
    const el = root.querySelector<T>(s);
    if (el) return el;
  }
  return null;
}

function qa(sels: string[], root: ParentNode = document): HTMLElement[] {
  for (const s of sels) {
    const els = Array.from(root.querySelectorAll<HTMLElement>(s));
    if (els.length) return els;
  }
  return [];
}

const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

export type WaStatus = 'ready' | 'logged_out' | 'loading';

export function status(): WaStatus {
  if (q(WA.loggedIn)) return 'ready';
  if (q(WA.qr)) return 'logged_out';
  return 'loading';
}

export class SiteError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

function requireReady() {
  const s = status();
  if (s === 'logged_out') throw new SiteError('logged_out', 'WhatsApp Web is logged out. The user needs to re-scan the QR code.');
  if (s === 'loading') throw new SiteError('loading', 'WhatsApp Web is still loading.');
}

export function listChats(unreadOnly = false, limit = 30): ChatSummary[] {
  requireReady();
  const rows = qa(WA.chatList);
  const out: ChatSummary[] = [];
  for (const row of rows) {
    const name = clean(q(WA.chatTitle, row)?.getAttribute('title') ?? q(WA.chatTitle, row)?.textContent);
    if (!name) continue;
    const titles = Array.from(row.querySelectorAll('span[title]')).map((s) => s.getAttribute('title') ?? '');
    const lastMessage = clean(titles[1] ?? q(WA.chatPreview, row)?.textContent ?? '');
    const badge = q(WA.unreadBadge, row);
    const unread = badge ? Number((badge.textContent ?? '').replace(/\D/g, '')) || 1 : 0;
    const time = clean(q(WA.chatTime, row)?.textContent ?? '');
    if (unreadOnly && !unread) continue;
    out.push({ name, lastMessage, time, unread });
    if (out.length >= limit) break;
  }
  return out;
}

export function openChatName(): string {
  const el = q(WA.openChatHeader);
  return clean(el?.getAttribute('title') ?? el?.textContent);
}

/** "[10:32, 13/10/2026] Kouvas: " -> { time, author } */
export function parsePrePlain(meta: string): { time: string; author: string } {
  const m = meta.match(/^\[([^\]]+)\]\s*([^:]*):?\s*$/);
  return m ? { time: (m[1] ?? '').trim(), author: (m[2] ?? '').trim() } : { time: '', author: '' };
}

export function readChat(limit = 30): ChatThread {
  requireReady();
  const name = openChatName();
  if (!name) throw new SiteError('no_chat', 'No chat is open in WhatsApp Web.');
  const rows = qa(WA.messageRows);
  const messages: ChatMessage[] = [];
  for (const row of rows) {
    const metaEl = q(WA.messageMeta, row);
    const textEl = q(WA.messageText, row);
    const text = clean(textEl?.innerText ?? textEl?.textContent);
    if (!text) continue;
    const out = row.matches('.message-out') || !!row.querySelector('.message-out') || (row.getAttribute('data-id') ?? '').startsWith('true_');
    const { time, author } = parsePrePlain(metaEl?.getAttribute('data-pre-plain-text') ?? '');
    messages.push({ from: out ? 'me' : 'them', author: author || (out ? 'me' : name), time, text });
  }
  return { name, messages: messages.slice(-limit) };
}

export async function openChat(name: string): Promise<ChatThread> {
  requireReady();
  if (openChatName().toLowerCase() === name.toLowerCase()) return readChat();
  const target = name.toLowerCase();
  const findRow = () =>
    qa(WA.chatList).find((row) => {
      const t = (q(WA.chatTitle, row)?.getAttribute('title') ?? '').toLowerCase();
      return t === target || t.includes(target);
    });
  let row = findRow();
  if (!row) {
    // Search for it. The search box filters the chat list.
    const search = q(WA.searchBox);
    if (!search) throw new SiteError('not_found', `Chat "${name}" is not in the visible list and search is unavailable.`);
    await typeInto(search, name, { clear: true });
    row = (await waitFor(findRow, 4000)) ?? undefined;
  }
  if (!row) throw new SiteError('not_found', `No chat found for "${name}".`);
  const clickable = (row.querySelector('[role="gridcell"], [tabindex]') as HTMLElement | null) ?? row;
  await clickElement(clickable);
  const opened = await waitFor(() => openChatName().toLowerCase().includes(target) || null, 5000);
  if (!opened) throw new SiteError('open_failed', `Clicked "${name}" but the chat did not open.`);
  await sleep(400);
  return readChat();
}

/**
 * Types and sends a message into the open chat at human pace.
 * The caller (sender in the panel) has already checked approval and pacing.
 */
export async function sendMessage(chatName: string, text: string, cps: number): Promise<{ sentTo: string }> {
  requireReady();
  await openChat(chatName);
  const composer = await waitFor(() => q<HTMLElement>(WA.composer), 4000);
  if (!composer) throw new SiteError('no_composer', 'Could not find the message box.');
  await typeInto(composer, text, { clear: true, cps });
  await sleep(250);
  const send = await waitFor(() => q<HTMLElement>(WA.sendButton), 3000);
  if (!send) throw new SiteError('no_send', 'Could not find the Send button.');
  await clickElement((send.closest('button') as HTMLElement | null) ?? send);
  // Confirm the composer cleared, which is how WhatsApp signals the send.
  const cleared = await waitFor(() => (clean(q(WA.composer)?.textContent) === '' ? true : null), 4000);
  if (!cleared) throw new SiteError('send_unconfirmed', 'Pressed Send but the message box did not clear.');
  return { sentTo: openChatName() };
}

/** Places a WhatsApp voice call from the open chat. Used later by the calls path. */
export const VOICE_CALL = ['#main header button[aria-label*="Voice call" i]', '#main header [data-icon="voice-call"]'];
