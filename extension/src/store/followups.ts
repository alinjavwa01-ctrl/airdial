import { todayLocal } from './storage';
import type { Contact } from './types';

/** Contacts whose next step is due on or before `day` (default today). */
export function dueContacts(contacts: Contact[], day = todayLocal()): Contact[] {
  return contacts
    .filter((c) => c.nextDate && c.nextDate <= day && c.stage !== 'lost' && c.stage !== 'won')
    .sort((a, b) => a.nextDate.localeCompare(b.nextDate));
}
