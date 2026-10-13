import { useEffect, useState, useCallback } from 'react';
import {
  DEFAULT_PLAYBOOK,
  DEFAULT_SETTINGS,
  type Approval,
  type AuditEntry,
  type Contact,
  type Playbook,
  type SendRecord,
  type Settings,
  type Task,
} from './types';

export interface StoreShape {
  settings: Settings;
  playbook: Playbook;
  contacts: Contact[];
  approvals: Approval[];
  audit: AuditEntry[];
  tasks: Task[];
  sends: SendRecord[];
  /** Backend sync cursor: content hashes already pushed, and the last audit time pushed. */
  sync: { hashes: Record<string, string>; auditAt: string };
}

export const DEFAULTS: StoreShape = {
  settings: DEFAULT_SETTINGS,
  playbook: DEFAULT_PLAYBOOK,
  contacts: [],
  approvals: [],
  audit: [],
  tasks: [],
  sends: [],
  sync: { hashes: {}, auditAt: '' },
};

type Key = keyof StoreShape;

// Caps so chrome.storage.local stays small. The backend keeps the full history.
const CAPS: Partial<Record<Key, number>> = { audit: 2000, tasks: 50, sends: 2000, approvals: 500 };

export async function load<K extends Key>(key: K): Promise<StoreShape[K]> {
  const got = await chrome.storage.local.get(key);
  const value = got[key] as StoreShape[K] | undefined;
  if (value === undefined) return structuredClone(DEFAULTS[key]);
  // Merge new default fields into older saved settings.
  if (key === 'settings') {
    const s = value as Settings;
    return { ...DEFAULT_SETTINGS, ...s, gateway: { ...DEFAULT_SETTINGS.gateway, ...s.gateway }, pacing: { ...DEFAULT_SETTINGS.pacing, ...s.pacing }, autoSend: { ...DEFAULT_SETTINGS.autoSend, ...s.autoSend } } as StoreShape[K];
  }
  return value;
}

export async function save<K extends Key>(key: K, value: StoreShape[K]): Promise<void> {
  const cap = CAPS[key];
  const trimmed = cap && Array.isArray(value) && value.length > cap ? (value.slice(-cap) as StoreShape[K]) : value;
  await chrome.storage.local.set({ [key]: trimmed });
}

// Serialise read-modify-write per key so concurrent updates (agent loop + UI)
// don't clobber each other within one extension page.
const chains = new Map<Key, Promise<unknown>>();

export function update<K extends Key>(key: K, fn: (current: StoreShape[K]) => StoreShape[K]): Promise<StoreShape[K]> {
  const prev = chains.get(key) ?? Promise.resolve();
  const next = prev.then(async () => {
    const current = await load(key);
    const value = fn(current);
    await save(key, value);
    return value;
  });
  chains.set(key, next.catch(() => undefined));
  return next;
}

export function useStored<K extends Key>(key: K): [StoreShape[K], (fn: (current: StoreShape[K]) => StoreShape[K]) => Promise<StoreShape[K]>, boolean] {
  const [value, setValue] = useState<StoreShape[K]>(DEFAULTS[key]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    load(key).then((v) => {
      if (alive) {
        setValue(v);
        setReady(true);
      }
    });
    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && key in changes) load(key).then((v) => alive && setValue(v));
    };
    chrome.storage.onChanged.addListener(listener);
    return () => {
      alive = false;
      chrome.storage.onChanged.removeListener(listener);
    };
  }, [key]);

  // Optimistic: controlled inputs need the new value this render, not after the storage round trip.
  const set = useCallback(
    (fn: (current: StoreShape[K]) => StoreShape[K]) => {
      setValue((v) => fn(v));
      return update(key, fn);
    },
    [key],
  );
  return [value, set, ready];
}

export function uid(prefix = ''): string {
  return prefix + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function todayLocal(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function contactKey(c: { channel: string; handle?: string; name: string }): string {
  return `${c.channel}:${(c.handle || c.name).trim().toLowerCase()}`;
}
