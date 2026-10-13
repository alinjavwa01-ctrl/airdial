// LinkedIn adapter: messaging threads, conversation list, profiles.
// Selectors live here only, same rule as WhatsApp.

import type { ChatMessage, ChatSummary, ChatThread, Profile } from '../protocol';
import { clickElement, sleep, typeInto, waitFor } from '../dom';
import { SiteError } from './whatsapp';

export const LI = {
  convoItems: ['.msg-conversation-listitem', 'li.msg-conversations-container__convo-item'],
  convoName: ['.msg-conversation-listitem__participant-names', '.msg-conversation-card__participant-names', 'h3'],
  convoSnippet: ['.msg-conversation-card__message-snippet', '.msg-conversation-listitem__message-snippet', 'p'],
  convoTime: ['.msg-conversation-listitem__time-stamp', 'time'],
  convoUnread: ['.msg-conversation-card__unread-count', '.notification-badge--show'],
  convoLink: ['a.msg-conversation-listitem__link', 'a', '[tabindex]'],
  threadTitle: ['.msg-entity-lockup__entity-title', 'h2.msg-overlay-bubble-header__title', '.msg-thread__link-to-profile', '#thread-detail-jump-target'],
  events: ['.msg-s-message-list__event', 'li.msg-s-message-list__event'],
  groupName: ['.msg-s-message-group__name', '.msg-s-message-group__profile-link'],
  groupTime: ['.msg-s-message-group__timestamp', 'time'],
  body: ['.msg-s-event-listitem__body', 'p.msg-s-event-listitem__body'],
  composer: ['.msg-form__contenteditable[contenteditable="true"]', 'div.msg-form__contenteditable', 'div[role="textbox"][contenteditable="true"]'],
  sendButton: ['button.msg-form__send-button', 'button.msg-form__send-btn', 'button[type="submit"].msg-form__send-button'],
  profileName: ['main h1', 'h1.text-heading-xlarge', 'h1'],
  profileHeadline: ['main .text-body-medium.break-words', '.pv-text-details__left-panel .text-body-medium'],
  profileLocation: ['main .text-body-small.inline.t-black--light.break-words', '.pv-text-details__left-panel .text-body-small'],
  aboutSection: ['#about'],
  experienceSection: ['#experience'],
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

function sectionText(sels: string[]): string {
  const anchor = q(sels);
  const section = anchor?.closest('section') ?? anchor?.parentElement;
  return clean(section?.innerText ?? section?.textContent).slice(0, 2000);
}

export function listConversations(unreadOnly = false, limit = 30): ChatSummary[] {
  const out: ChatSummary[] = [];
  for (const item of qa(LI.convoItems)) {
    const name = clean(q(LI.convoName, item)?.textContent);
    if (!name) continue;
    const unreadEl = q(LI.convoUnread, item);
    const unread = unreadEl ? Number(clean(unreadEl.textContent).replace(/\D/g, '')) || 1 : 0;
    if (unreadOnly && !unread) continue;
    out.push({ name, lastMessage: clean(q(LI.convoSnippet, item)?.textContent), time: clean(q(LI.convoTime, item)?.textContent), unread });
    if (out.length >= limit) break;
  }
  return out;
}

export function threadName(): string {
  return clean(q(LI.threadTitle)?.textContent);
}

export function readThread(limit = 30): ChatThread {
  const name = threadName();
  const events = qa(LI.events);
  if (!events.length) throw new SiteError('no_thread', 'No LinkedIn message thread is open.');
  const messages: ChatMessage[] = [];
  let author = '';
  let time = '';
  for (const ev of events) {
    author = clean(q(LI.groupName, ev)?.textContent) || author;
    time = clean(q(LI.groupTime, ev)?.textContent) || time;
    for (const body of qa(LI.body, ev)) {
      const text = clean(body.innerText ?? body.textContent);
      if (!text) continue;
      const fromThem = !!name && author.toLowerCase() === name.toLowerCase();
      messages.push({ from: fromThem ? 'them' : 'me', author, time, text });
    }
  }
  return { name, messages: messages.slice(-limit) };
}

export async function openConversation(name: string): Promise<ChatThread> {
  const target = name.toLowerCase();
  const item = qa(LI.convoItems).find((i) => clean(q(LI.convoName, i)?.textContent).toLowerCase().includes(target));
  if (!item) throw new SiteError('not_found', `No LinkedIn conversation with "${name}" in the list. Open linkedin.com/messaging first.`);
  await clickElement(q(LI.convoLink, item) ?? item);
  const ok = await waitFor(() => threadName().toLowerCase().includes(target) || null, 5000);
  if (!ok) throw new SiteError('open_failed', `Clicked "${name}" but the thread did not open.`);
  await sleep(300);
  return readThread();
}

export async function sendMessage(name: string, text: string, cps: number): Promise<{ sentTo: string }> {
  if (!threadName().toLowerCase().includes(name.toLowerCase())) await openConversation(name);
  const composer = await waitFor(() => q<HTMLElement>(LI.composer), 4000);
  if (!composer) throw new SiteError('no_composer', 'Could not find the LinkedIn message box.');
  await typeInto(composer, text, { clear: true, cps });
  await sleep(250);
  const send = await waitFor(() => {
    const b = q<HTMLButtonElement>(LI.sendButton);
    return b && !b.disabled ? b : null;
  }, 3000);
  if (!send) throw new SiteError('no_send', 'The LinkedIn Send button is missing or disabled.');
  await clickElement(send);
  const cleared = await waitFor(() => (clean(q(LI.composer)?.textContent) === '' ? true : null), 4000);
  if (!cleared) throw new SiteError('send_unconfirmed', 'Pressed Send but the LinkedIn message box did not clear.');
  return { sentTo: threadName() };
}

export function readProfile(): Profile {
  const name = clean(q(LI.profileName)?.textContent);
  if (!name || !/\/in\//.test(location.pathname)) throw new SiteError('no_profile', 'This tab is not a LinkedIn profile.');
  return {
    name,
    headline: clean(q(LI.profileHeadline)?.textContent),
    location: clean(q(LI.profileLocation)?.textContent),
    about: sectionText(LI.aboutSection),
    experience: sectionText(LI.experienceSection),
    url: location.href.split('?')[0] ?? location.href,
  };
}
