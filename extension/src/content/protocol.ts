// Messages between the side panel and the content script.

export interface PageElement {
  ref: string;
  role: string;
  name: string;
  tag: string;
  value?: string;
  /** Password, card number, CVV, bank fields: the agent may never type here. */
  sensitive?: boolean;
  disabled?: boolean;
}

export interface Snapshot {
  url: string;
  title: string;
  site: string | null;
  text: string;
  truncated: boolean;
  elements: PageElement[];
}

export interface ChatSummary {
  name: string;
  lastMessage: string;
  time: string;
  unread: number;
}

export interface ChatMessage {
  from: 'them' | 'me';
  author: string;
  time: string;
  text: string;
}

export interface ChatThread {
  name: string;
  messages: ChatMessage[];
}

export interface Profile {
  name: string;
  headline: string;
  location: string;
  about: string;
  experience: string;
  url: string;
}

export type ContentCommand =
  | { cmd: 'ping' }
  | { cmd: 'snapshot'; maxChars?: number; query?: string }
  | { cmd: 'click'; ref: string }
  | { cmd: 'type'; ref: string; text: string; clear?: boolean; cps?: number }
  | { cmd: 'key'; key: string; ref?: string }
  | { cmd: 'scroll'; direction: 'up' | 'down'; ref?: string }
  | { cmd: 'describe'; ref: string }
  | { cmd: 'banner'; on: boolean; label?: string }
  | { cmd: 'site'; action: string; args?: Record<string, unknown> };

export type ContentResponse<T = unknown> = { ok: true; data: T } | { ok: false; error: string; code?: string };

export const CONTENT_MESSAGE = 'airdial-agent';
