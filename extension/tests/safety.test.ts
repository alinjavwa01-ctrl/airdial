import { describe, expect, it } from 'vitest';
import { clickTier, keyTier, textLooksSensitive, typeTier } from '../src/agent/safety';

describe('permission tiers', () => {
  it('blocks money, deletes and terms', () => {
    expect(clickTier({ role: 'button', name: 'Pay now', tag: 'button' }).tier).toBe('never');
    expect(clickTier({ role: 'menuitem', name: 'Delete chat', tag: 'div' }).tier).toBe('never');
    expect(clickTier({ role: 'button', name: 'I agree', tag: 'button' }).tier).toBe('never');
  });
  it('asks before sending or submitting', () => {
    expect(clickTier({ role: 'button', name: 'Send', tag: 'button' }).tier).toBe('approve');
    expect(clickTier({ role: 'button', name: 'Continue', tag: 'button', type: 'submit', form: true }).tier).toBe('approve');
    expect(keyTier('Enter', { role: 'textbox', name: 'Type a message', tag: 'div' }).tier).toBe('approve');
  });
  it('lets reading and navigation clicks through', () => {
    expect(clickTier({ role: 'link', name: 'Pricing', tag: 'a' }).tier).toBe('free');
    expect(clickTier({ role: 'button', name: 'Kouvas', tag: 'div' }).tier).toBe('free');
    expect(keyTier('Escape', null).tier).toBe('free');
  });
  it('never types into sensitive fields or sensitive text', () => {
    expect(typeTier({ role: 'textbox', name: 'Password', tag: 'input', sensitive: true }).tier).toBe('never');
    expect(textLooksSensitive('card 4242 4242 4242 4242')).toBe(true);
    expect(textLooksSensitive('password: hunter2')).toBe(true);
    expect(textLooksSensitive('Call me on +260 97 1234567 about 50 kg')).toBe(false);
    expect(textLooksSensitive('Order 1234567890123 is ready')).toBe(false);
  });
});
