// Real input through the Chrome DevTools Protocol (chrome.debugger), the way
// Claude in Chrome acts: trusted mouse and keyboard events that work on sites
// where synthetic DOM events are ignored, coordinate clicks from screenshots,
// and screenshots of any allowed tab without <all_urls>.
//
// Chrome shows a "started debugging this browser" bar while attached; we attach
// for the length of a task and detach when it ends.

const attached = new Set<number>();
const unavailable = new Set<number>();

chrome.debugger?.onDetach.addListener((source) => {
  if (source.tabId !== undefined) attached.delete(source.tabId);
});

async function send<T = unknown>(tabId: number, method: string, params?: Record<string, unknown>): Promise<T> {
  return (await chrome.debugger.sendCommand({ tabId }, method, params)) as T;
}

/** Attaches if possible. Returns false when another debugger (e.g. DevTools) holds the tab. */
export async function ensureAttached(tabId: number): Promise<boolean> {
  if (!chrome.debugger) return false;
  if (attached.has(tabId)) return true;
  if (unavailable.has(tabId)) return false;
  try {
    await chrome.debugger.attach({ tabId }, '1.3');
    attached.add(tabId);
    return true;
  } catch {
    unavailable.add(tabId);
    return false;
  }
}

export async function detachAll(): Promise<void> {
  const ids = [...attached];
  attached.clear();
  unavailable.clear();
  await Promise.all(ids.map((tabId) => chrome.debugger.detach({ tabId }).catch(() => undefined)));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function mouseMove(tabId: number, x: number, y: number): Promise<void> {
  await send(tabId, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
}

export async function click(tabId: number, x: number, y: number, clickCount = 1): Promise<void> {
  await mouseMove(tabId, x, y);
  await sleep(40);
  await send(tabId, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount });
  await sleep(30);
  await send(tabId, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount });
}

export async function wheel(tabId: number, x: number, y: number, deltaY: number): Promise<void> {
  await send(tabId, 'Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY });
}

export async function insertText(tabId: number, text: string): Promise<void> {
  await send(tabId, 'Input.insertText', { text });
}

interface KeyDef {
  key: string;
  code: string;
  keyCode: number;
  text?: string;
}

const NAMED: Record<string, KeyDef> = {
  enter: { key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' },
  tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
  escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
  esc: { key: 'Escape', code: 'Escape', keyCode: 27 },
  backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8 },
  delete: { key: 'Delete', code: 'Delete', keyCode: 46 },
  space: { key: ' ', code: 'Space', keyCode: 32, text: ' ' },
  arrowup: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  arrowdown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  arrowleft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  arrowright: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  home: { key: 'Home', code: 'Home', keyCode: 36 },
  end: { key: 'End', code: 'End', keyCode: 35 },
  pageup: { key: 'PageUp', code: 'PageUp', keyCode: 33 },
  pagedown: { key: 'PageDown', code: 'PageDown', keyCode: 34 },
};

const MODIFIERS: Record<string, { bit: number; def: KeyDef }> = {
  alt: { bit: 1, def: { key: 'Alt', code: 'AltLeft', keyCode: 18 } },
  ctrl: { bit: 2, def: { key: 'Control', code: 'ControlLeft', keyCode: 17 } },
  control: { bit: 2, def: { key: 'Control', code: 'ControlLeft', keyCode: 17 } },
  meta: { bit: 4, def: { key: 'Meta', code: 'MetaLeft', keyCode: 91 } },
  cmd: { bit: 4, def: { key: 'Meta', code: 'MetaLeft', keyCode: 91 } },
  shift: { bit: 8, def: { key: 'Shift', code: 'ShiftLeft', keyCode: 16 } },
};

export function parseKey(combo: string): { mods: { bit: number; def: KeyDef }[]; modifiers: number; main: KeyDef } {
  const parts = combo.split('+').map((p) => p.trim()).filter(Boolean);
  const last = parts.pop() ?? '';
  let modifiers = 0;
  const mods: { bit: number; def: KeyDef }[] = [];
  for (const p of parts) {
    const m = MODIFIERS[p.toLowerCase()];
    if (!m) throw new Error(`Unknown modifier "${p}"`);
    modifiers |= m.bit;
    mods.push(m);
  }
  const named = NAMED[last.toLowerCase()];
  if (named) return { mods, modifiers, main: named };
  if (/^F([1-9]|1[0-2])$/i.test(last)) {
    const n = Number(last.slice(1));
    return { mods, modifiers, main: { key: last.toUpperCase(), code: last.toUpperCase(), keyCode: 111 + n } };
  }
  if (last.length === 1) {
    const ch = last;
    const upper = ch.toUpperCase();
    const isLetter = /[a-z]/i.test(ch);
    const isDigit = /\d/.test(ch);
    return {
      mods,
      modifiers,
      main: {
        key: ch,
        code: isLetter ? `Key${upper}` : isDigit ? `Digit${ch}` : '',
        keyCode: isLetter || isDigit ? upper.charCodeAt(0) : 0,
        text: modifiers & ~8 ? undefined : ch,
      },
    };
  }
  throw new Error(`Unknown key "${combo}"`);
}

/** Presses a key or combo like "Enter", "Escape", "ctrl+a", "shift+Tab". */
export async function pressKey(tabId: number, combo: string): Promise<void> {
  const { mods, modifiers, main } = parseKey(combo);
  let held = 0;
  for (const { bit, def } of mods) {
    held |= bit;
    await send(tabId, 'Input.dispatchKeyEvent', { type: 'rawKeyDown', key: def.key, code: def.code, windowsVirtualKeyCode: def.keyCode, modifiers: held });
  }
  const base = { key: main.key, code: main.code, windowsVirtualKeyCode: main.keyCode, nativeVirtualKeyCode: main.keyCode, modifiers };
  await send(tabId, 'Input.dispatchKeyEvent', main.text ? { type: 'keyDown', text: main.text, unmodifiedText: main.text, ...base } : { type: 'rawKeyDown', ...base });
  await send(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  for (const { def } of [...mods].reverse()) {
    await send(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', key: def.key, code: def.code, windowsVirtualKeyCode: def.keyCode, modifiers: 0 });
  }
}

export async function screenshot(tabId: number): Promise<{ data: string; width: number; height: number }> {
  const metrics = await send<{ cssVisualViewport: { pageX: number; pageY: number; clientWidth: number; clientHeight: number } }>(tabId, 'Page.getLayoutMetrics');
  const { pageX, pageY, clientWidth: width, clientHeight: height } = metrics.cssVisualViewport;
  // Capture the visible viewport at CSS-pixel scale so screenshot coordinates are click coordinates.
  const shot = await send<{ data: string }>(tabId, 'Page.captureScreenshot', {
    format: 'jpeg',
    quality: 60,
    clip: { x: pageX, y: pageY, width, height, scale: 1 },
  });
  return { data: shot.data, width, height };
}
