import { describe, expect, it } from 'vitest';
import { checkPacing } from '../src/send/sender';
import { DEFAULT_SETTINGS } from '../src/store/types';

const s = DEFAULT_SETTINGS;
const now = new Date('2026-10-13T10:00:00');
const at = (secAgo: number) => new Date(now.getTime() - secAgo * 1000).toISOString();

describe('pacing', () => {
  it('spaces out messages to new contacts', () => {
    const sends = [{ contactKey: 'whatsapp:banda', at: at(30) }];
    const d = checkPacing({ channel: 'whatsapp', contactName: 'Kouvas' }, sends, s, now);
    expect(d.ok).toBe(false);
    expect(d.waitSec).toBe(90);
  });
  it('lets known contacts through', () => {
    const sends = [{ contactKey: 'whatsapp:kouvas', at: at(3600 * 30) }, { contactKey: 'whatsapp:banda', at: at(10) }];
    expect(checkPacing({ channel: 'whatsapp', contactName: 'Kouvas' }, sends, s, now).ok).toBe(true);
  });
  it('enforces the daily cap per contact', () => {
    const sends = Array.from({ length: 5 }, (_, i) => ({ contactKey: 'whatsapp:kouvas', at: at(600 + i) }));
    const d = checkPacing({ channel: 'whatsapp', contactName: 'Kouvas' }, sends, s, now);
    expect(d.ok).toBe(false);
    expect(d.waitSec).toBeUndefined();
  });
});
