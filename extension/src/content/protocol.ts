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
  text: string;
  truncated: boolean;
  elements: PageElement[];
}

/** Element info plus its centre in viewport CSS pixels (after scrolling it into view). */
export interface ElementTarget {
  ref?: string;
  role: string;
  name: string;
  tag: string;
  type?: string;
  form?: boolean;
  sensitive?: boolean;
  editable?: boolean;
  x: number;
  y: number;
}

export type ContentCommand =
  | { cmd: 'ping' }
  | { cmd: 'snapshot'; maxChars?: number; query?: string }
  | { cmd: 'click'; ref: string }
  | { cmd: 'type'; ref: string; text: string; clear?: boolean; cps?: number }
  | { cmd: 'key'; key: string; ref?: string }
  | { cmd: 'scroll'; direction: 'up' | 'down'; ref?: string }
  | { cmd: 'describe'; ref: string }
  | { cmd: 'target'; ref?: string; x?: number; y?: number }
  | { cmd: 'select'; ref: string; option: string }
  | { cmd: 'hover'; ref: string }
  | { cmd: 'banner'; on: boolean; label?: string };

export type ContentResponse<T = unknown> = { ok: true; data: T } | { ok: false; error: string; code?: string };

export const CONTENT_MESSAGE = 'airdial-agent';
