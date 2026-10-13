// Customer sign-in with Supabase Auth (email + password for now; Google
// sign-in slots in here later). The session lives in chrome.storage.local;
// the access token is refreshed before it expires and sent to the AirDial
// service, which verifies it.

import { load, update } from '../store/storage';

type Env = Record<string, string | undefined>;
const env: Env = (import.meta as { env?: Env }).env ?? {};

// Publishable values (safe to ship in the extension).
export const SUPABASE_URL = env.WXT_SUPABASE_URL ?? 'https://fwehwxyzowbobxoeusef.supabase.co';
export const SUPABASE_KEY = env.WXT_SUPABASE_PUBLISHABLE_KEY ?? 'sb_publishable_4NAe5LYpqjgQRFAtUDP6IA_r6Wg3Cri';

export interface Session {
  email: string;
  accessToken: string;
  refreshToken: string;
  /** epoch seconds */
  expiresAt: number;
}

export class AuthError extends Error {}

async function auth(path: string, body: object): Promise<any> {
  let res: Response;
  try {
    res = await fetch(`${SUPABASE_URL}/auth/v1/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: SUPABASE_KEY },
      body: JSON.stringify(body),
    });
  } catch {
    throw new AuthError("Can't reach AirDial. Check your internet connection.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg: string = data.msg || data.error_description || data.message || '';
    if (/invalid login/i.test(msg)) throw new AuthError('That email and password don’t match.');
    if (/not confirmed/i.test(msg)) throw new AuthError('Confirm your email first: open the link we sent you, then sign in.');
    if (/already registered/i.test(msg)) throw new AuthError('That email already has an account. Sign in instead.');
    if (/password/i.test(msg)) throw new AuthError(msg);
    throw new AuthError('Sign-in failed. Try again in a minute.');
  }
  return data;
}

function toSession(email: string, d: any): Session {
  return { email, accessToken: d.access_token, refreshToken: d.refresh_token, expiresAt: d.expires_at ?? Math.floor(Date.now() / 1000) + (d.expires_in ?? 3600) };
}

async function store(session: Session | undefined) {
  await update('settings', (s) => ({ ...s, gateway: { ...s.gateway, mode: 'airdial', session } }));
}

export async function signIn(email: string, password: string): Promise<Session> {
  const d = await auth('token?grant_type=password', { email, password });
  const s = toSession(email, d);
  await store(s);
  return s;
}

/** Returns a session if the project signs people in straight away, otherwise null (check email). */
export async function signUp(email: string, password: string, name: string): Promise<Session | null> {
  const d = await auth('signup', { email, password, data: { name } });
  if (d.access_token) {
    const s = toSession(email, d);
    await store(s);
    return s;
  }
  return null;
}

export async function signOut(): Promise<void> {
  await store(undefined);
}

let refreshing: Promise<string> | null = null;

/** A valid access token for the AirDial service, refreshing it if needed. */
export async function airdialToken(): Promise<string> {
  const { gateway } = await load('settings');
  if (gateway.backendToken) return gateway.backendToken; // internal testing token
  const s = gateway.session;
  if (!s) throw new AuthError('Sign in to AirDial in Settings to start.');
  if (s.expiresAt - 60 > Date.now() / 1000) return s.accessToken;
  refreshing ??= (async () => {
    try {
      const d = await auth('token?grant_type=refresh_token', { refresh_token: s.refreshToken });
      const next = toSession(s.email, d);
      await store(next);
      return next.accessToken;
    } catch {
      await store(undefined);
      throw new AuthError('Your AirDial sign-in has expired. Sign in again in Settings.');
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}
