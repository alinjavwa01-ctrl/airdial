// Side-panel side of the browser: tabs, permissions, content-script calls,
// navigation and screenshots.

import { CONTENT_MESSAGE, type ContentCommand, type ContentResponse } from '../content/protocol';

export class BrowserError extends Error {
  constructor(public code: string, message: string, public origin?: string) {
    super(message);
  }
}

export function originPattern(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return `${u.protocol}//${u.host}/*`;
  } catch {
    return null;
  }
}

export function hostOf(url: string | undefined): string {
  try {
    return url ? new URL(url).hostname : '';
  } catch {
    return '';
  }
}

export async function hasAccess(url: string): Promise<boolean> {
  const origin = originPattern(url);
  if (!origin) return false;
  return chrome.permissions.contains({ origins: [origin] });
}

/** Must be called from a user gesture (a button click in the panel). */
export async function requestAccess(origin: string): Promise<boolean> {
  return chrome.permissions.request({ origins: [origin] });
}

export async function activeTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab;
}

export async function getTab(tabId: number): Promise<chrome.tabs.Tab> {
  try {
    return await chrome.tabs.get(tabId);
  } catch {
    throw new BrowserError('tab_closed', 'That tab was closed.');
  }
}

export async function listTabs(): Promise<{ id: number; title: string; url: string; active: boolean }[]> {
  const tabs = await chrome.tabs.query({ lastFocusedWindow: true });
  return tabs.filter((t) => t.id !== undefined).map((t) => ({ id: t.id!, title: t.title ?? '', url: t.url ?? '', active: !!t.active }));
}

async function ping(tabId: number): Promise<boolean> {
  try {
    const res = (await chrome.tabs.sendMessage(tabId, { type: CONTENT_MESSAGE, command: { cmd: 'ping' } })) as ContentResponse | undefined;
    return !!res?.ok;
  } catch {
    return false;
  }
}

export async function ensureInjected(tabId: number): Promise<void> {
  const tab = await getTab(tabId);
  const url = tab.url ?? '';
  if (!/^https?:/.test(url)) throw new BrowserError('unsupported_page', `The agent can't work on this kind of page (${url || 'blank tab'}). Navigate to a website first.`);
  if (await ping(tabId)) return;
  if (!(await hasAccess(url))) {
    throw new BrowserError('no_access', `The agent doesn't have access to ${hostOf(url)} yet.`, originPattern(url) ?? undefined);
  }
  await chrome.scripting.executeScript({ target: { tabId }, files: ['/page-agent.js'] });
  if (!(await ping(tabId))) throw new BrowserError('inject_failed', `Could not connect to ${hostOf(url)}. Reload the tab and try again.`);
}

export async function call<T>(tabId: number, command: ContentCommand): Promise<T> {
  await ensureInjected(tabId);
  const res = (await chrome.tabs.sendMessage(tabId, { type: CONTENT_MESSAGE, command })) as ContentResponse<T> | undefined;
  if (!res) throw new BrowserError('no_response', 'The page did not respond. It may have navigated away.');
  if (!res.ok) throw new BrowserError(res.code ?? 'page_error', res.error);
  return res.data;
}

export function waitForLoad(tabId: number, timeoutMs = 20000): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      chrome.tabs.onUpdated.removeListener(listener);
      clearTimeout(timer);
      // Give client-side apps a moment to render after load.
      setTimeout(resolve, 600);
    };
    const listener = (id: number, info: { status?: string }) => {
      if (id === tabId && info.status === 'complete') finish();
    };
    const timer = setTimeout(finish, timeoutMs);
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then((t) => t.status === 'complete' && finish(), finish);
  });
}

export async function navigate(tabId: number, url: string): Promise<chrome.tabs.Tab> {
  await chrome.tabs.update(tabId, { url });
  await new Promise((r) => setTimeout(r, 150));
  await waitForLoad(tabId);
  return getTab(tabId);
}

export async function openTab(url: string): Promise<chrome.tabs.Tab> {
  const tab = await chrome.tabs.create({ url, active: true });
  await waitForLoad(tab.id!);
  return getTab(tab.id!);
}

export async function focusTab(tabId: number): Promise<chrome.tabs.Tab> {
  const tab = await chrome.tabs.update(tabId, { active: true });
  if (tab?.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true });
  return getTab(tabId);
}

export async function screenshot(tabId: number): Promise<string> {
  const tab = await focusTab(tabId);
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 60 });
    return dataUrl.replace(/^data:image\/jpeg;base64,/, '');
  } catch {
    throw new BrowserError('no_screenshot', 'Screenshots need "Allow on all sites" in Settings. Use the page text instead.', '<all_urls>');
  }
}

export async function setBanner(tabId: number | undefined, on: boolean, label?: string): Promise<void> {
  if (tabId === undefined) return;
  try {
    if (!(await ping(tabId))) return;
    await chrome.tabs.sendMessage(tabId, { type: CONTENT_MESSAGE, command: { cmd: 'banner', on, label } });
  } catch {
    // Banner is best effort.
  }
}
