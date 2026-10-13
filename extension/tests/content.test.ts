import { beforeEach, describe, expect, it } from 'vitest';
import { listElements, findByRef, typeInto } from '../src/content/dom';
import * as wa from '../src/content/sites/whatsapp';

describe('page reading', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <form><label for="u">Email</label><input id="u" name="email">
      <input type="password" name="pw" aria-label="Password">
      <input name="cardnumber" placeholder="Card number">
      <button type="submit">Sign in</button></form>
      <a href="/pricing">Pricing</a>`;
  });
  it('lists interactive elements with refs and flags sensitive fields', () => {
    const els = listElements();
    const byName = Object.fromEntries(els.map((e) => [e.name, e]));
    expect(byName['Email']?.role).toBe('textbox');
    expect(byName['Password']?.sensitive).toBe(true);
    expect(byName['Card number']?.sensitive).toBe(true);
    expect(byName['Sign in']?.role).toBe('button');
    expect(findByRef(byName['Pricing']!.ref)?.textContent).toBe('Pricing');
  });
  it('types into inputs and fires input events', async () => {
    const input = document.getElementById('u') as HTMLInputElement;
    let fired = 0;
    input.addEventListener('input', () => fired++);
    await typeInto(input, 'a@b.co', { clear: true });
    expect(input.value).toBe('a@b.co');
    expect(fired).toBeGreaterThan(0);
  });
});

describe('WhatsApp Web adapter', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="side"><div contenteditable="true" aria-label="Search input textbox"></div></div>
      <div id="pane-side">
        <div role="listitem"><span title="Kouvas">Kouvas</span><span title="Can you send photos?">Can you send photos?</span><span aria-label="2 unread messages">2</span></div>
        <div role="listitem"><span title="Banda Catering">Banda Catering</span><span title="Thanks">Thanks</span></div>
      </div>
      <div id="main">
        <header><span title="Kouvas">Kouvas</span></header>
        <div role="row"><div class="message-in"><div data-pre-plain-text="[09:12, 13/10/2026] Kouvas: "><span class="selectable-text">Mwapoleni, how much for 50 kg T-bone?</span></div></div></div>
        <div role="row"><div class="message-out"><div data-pre-plain-text="[09:20, 13/10/2026] Me: "><span class="selectable-text">K120/kg. Delivery tomorrow?</span></div></div></div>
        <footer><div contenteditable="true" role="textbox"></div><button aria-label="Send">send</button></footer>
      </div>`;
  });
  it('detects login state', () => {
    expect(wa.status()).toBe('ready');
    document.body.innerHTML = '<canvas aria-label="Scan this QR code to link a device!"></canvas>';
    expect(wa.status()).toBe('logged_out');
    expect(() => wa.listChats()).toThrow(/logged out/);
  });
  it('lists chats with unread counts', () => {
    const chats = wa.listChats();
    expect(chats).toEqual([
      { name: 'Kouvas', lastMessage: 'Can you send photos?', time: '', unread: 2 },
      { name: 'Banda Catering', lastMessage: 'Thanks', time: '', unread: 0 },
    ]);
    expect(wa.listChats(true).map((c) => c.name)).toEqual(['Kouvas']);
  });
  it('reads the open chat, marking who said what', () => {
    const t = wa.readChat();
    expect(t.name).toBe('Kouvas');
    expect(t.messages).toEqual([
      { from: 'them', author: 'Kouvas', time: '09:12, 13/10/2026', text: 'Mwapoleni, how much for 50 kg T-bone?' },
      { from: 'me', author: 'Me', time: '09:20, 13/10/2026', text: 'K120/kg. Delivery tomorrow?' },
    ]);
  });
});
