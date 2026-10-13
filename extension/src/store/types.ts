// Shared data shapes. Everything here lives in chrome.storage.local today and
// maps 1:1 onto the backend tables in backend/supabase/migrations.

export type Channel = 'whatsapp' | 'linkedin' | 'email' | 'other';

/** Message types the user can switch auto-send on for (PRD: "auto-send per type"). */
export type MessageKind = 'reply' | 'follow_up' | 'price_quote' | 'confirmation' | 'other';

export const MESSAGE_KINDS: { kind: MessageKind; label: string }[] = [
  { kind: 'follow_up', label: 'Follow-ups' },
  { kind: 'confirmation', label: 'Order and payment confirmations' },
  { kind: 'reply', label: 'Replies' },
  { kind: 'price_quote', label: 'Price quotes' },
  { kind: 'other', label: 'Everything else' },
];

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface Settings {
  onboarded: boolean;
  userName: string;
  businessName: string;
  gateway: {
    /** direct = the user's own Anthropic key (dev/dogfood); airdial = AirDial backend. */
    mode: 'direct' | 'airdial';
    apiKey: string;
    backendUrl: string;
    backendToken: string;
    model: string;
    effort: Effort;
  };
  /** Hostnames the agent may act on. Reading the open tab is always allowed. */
  allowedSites: string[];
  autoSend: Record<MessageKind, boolean>;
  pacing: {
    /** Minimum seconds between messages to a number we have not messaged before. */
    newNumberGapSec: number;
    /** Max messages per contact per day. */
    dailyCapPerContact: number;
    /** Characters per second when typing into WhatsApp Web. */
    typingCps: number;
  };
  languages: string[];
  defaultLanguage: string;
  airdialApi: { enabled: boolean };
  morningHour: number;
}

export const DEFAULT_SETTINGS: Settings = {
  onboarded: false,
  userName: '',
  businessName: '',
  gateway: {
    mode: 'direct',
    apiKey: '',
    backendUrl: 'http://localhost:8787',
    backendToken: '',
    model: 'claude-opus-5-5',
    effort: 'medium',
  },
  allowedSites: ['web.whatsapp.com', 'mail.google.com', 'docs.google.com', 'www.linkedin.com'],
  autoSend: { reply: false, follow_up: false, price_quote: false, confirmation: false, other: false },
  pacing: { newNumberGapSec: 120, dailyCapPerContact: 5, typingCps: 9 },
  languages: ['English', 'Nyanja', 'Bemba', 'French'],
  defaultLanguage: 'English',
  airdialApi: { enabled: false },
  morningHour: 8,
};

export interface Playbook {
  about: string;
  tone: 'warm' | 'direct' | 'formal' | 'playful';
  prices: string;
  rules: string[];
  examples: string;
  signOff: string;
}

export const DEFAULT_PLAYBOOK: Playbook = {
  about: '',
  tone: 'warm',
  prices: '',
  rules: ['No prices before I know the volume.', '5% off if paid upfront.'],
  examples: '',
  signOff: '',
};

export type Stage = 'new' | 'qualifying' | 'quoted' | 'negotiating' | 'won' | 'customer' | 'lost';

export interface Contact {
  id: string;
  name: string;
  channel: Channel;
  /** Phone number, chat title or profile URL. */
  handle: string;
  stage: Stage;
  language?: string;
  notes: string;
  lastTheySaid: string;
  lastWeAsked: string;
  nextStep: string;
  /** YYYY-MM-DD */
  nextDate: string;
  cashExpected?: { amount: number; currency: string };
  history: { at: string; summary: string }[];
  updatedAt: string;
}

export type ApprovalStatus = 'pending' | 'sending' | 'sent' | 'skipped' | 'failed';

export interface Approval {
  id: string;
  createdAt: string;
  taskId?: string;
  contactName: string;
  contactId?: string;
  channel: Channel;
  kind: MessageKind;
  language?: string;
  theirLastMessage: string;
  draft: string;
  /** Why the agent wrote this, one line. */
  reason?: string;
  /** Page the conversation was on, used to send through the browser. */
  sourceUrl?: string;
  status: ApprovalStatus;
  edited?: boolean;
  error?: string;
  sentAt?: string;
}

export type Tier = 'free' | 'approve' | 'never';

export interface AuditEntry {
  id: string;
  at: string;
  taskId?: string;
  tier: Tier;
  action: string;
  label: string;
  url?: string;
  before?: string;
  after?: string;
  outcome: 'ok' | 'blocked' | 'error' | 'queued' | 'approved' | 'denied';
}

export type TaskStatus = 'running' | 'paused' | 'needs_you' | 'done' | 'error' | 'stopped';

export interface PlanStep {
  text: string;
  done: boolean;
}

export interface TaskLogLine {
  at: string;
  kind: 'action' | 'note' | 'agent' | 'error' | 'user';
  text: string;
}

export interface PendingQuestion {
  id: string;
  kind: 'question' | 'confirm' | 'permission';
  text: string;
  /** For permission prompts: the origin pattern to request. */
  origin?: string;
}

export interface Task {
  id: string;
  prompt: string;
  createdAt: string;
  status: TaskStatus;
  plan: PlanStep[];
  log: TaskLogLine[];
  pending?: PendingQuestion;
  result?: string;
  usage?: { inputTokens: number; outputTokens: number; costUsd: number };
}

export interface SendRecord {
  contactKey: string;
  at: string;
}
