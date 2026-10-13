import { load, todayLocal } from '../src/store/storage';
import { dueContacts } from '../src/store/followups';
import { scheduleSync } from '../src/store/sync';

// The service worker is thin: open the panel, keep the badge honest, and
// nudge the user each morning about follow-ups that are due. Scheduled sends
// that must run with the laptop closed belong to the backend.

const MORNING = 'airdial-morning';

async function scheduleMorning() {
  const { morningHour } = await load('settings');
  const next = new Date();
  next.setHours(morningHour, 0, 0, 0);
  if (next.getTime() <= Date.now()) next.setDate(next.getDate() + 1);
  await chrome.alarms.create(MORNING, { when: next.getTime(), periodInMinutes: 24 * 60 });
}

async function refreshBadge() {
  const [approvals, contacts, tasks] = await Promise.all([load('approvals'), load('contacts'), load('tasks')]);
  const pending = approvals.filter((a) => a.status === 'pending' || a.status === 'failed').length;
  const waiting = tasks.filter((t) => t.status === 'needs_you').length;
  const due = dueContacts(contacts, todayLocal()).length;
  const n = pending + waiting;
  await chrome.action.setBadgeBackgroundColor({ color: '#d6336c' });
  await chrome.action.setBadgeText({ text: n ? String(n) : due ? '•' : '' });
}

export default defineBackground(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);

  chrome.runtime.onInstalled.addListener(() => {
    scheduleMorning();
    refreshBadge();
  });
  chrome.runtime.onStartup.addListener(() => {
    scheduleMorning();
    refreshBadge();
    scheduleSync();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.approvals || changes.contacts || changes.tasks) refreshBadge();
    if (changes.approvals || changes.contacts || changes.audit) scheduleSync();
    if (changes.settings) scheduleMorning();
  });

  chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name !== MORNING) return;
    const due = dueContacts(await load('contacts'), todayLocal());
    if (!due.length) return;
    chrome.notifications.create('airdial-due', {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('/icon/128.png'),
      title: `${due.length} follow-up${due.length > 1 ? 's' : ''} due today`,
      message: due
        .slice(0, 4)
        .map((c) => `${c.name}: ${c.nextStep || 'follow up'}`)
        .join('\n'),
    });
  });

  chrome.notifications.onClicked.addListener(async () => {
    const win = await chrome.windows.getLastFocused();
    if (win.id !== undefined) chrome.sidePanel.open({ windowId: win.id }).catch(() => undefined);
  });
});
