import { beforeEach, describe, expect, it } from 'vitest';
import { listElements, findByRef, typeInto } from '../src/content/dom';

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
