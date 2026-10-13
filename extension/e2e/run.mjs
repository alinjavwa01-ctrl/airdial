// End-to-end test: the built extension in real Chromium, a fake WhatsApp Web,
// and the real backend with a scripted model (e2e/fake_backend.py).
//
//   npm run build && node e2e/run.mjs
//
// Checks: onboarding, task run with plan + live log, the approval gate on a
// direct "Send" click (denied), draft -> approval queue -> approve -> typed
// and sent in WhatsApp Web, contact memory, daily summary, backend sync.

import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ext = resolve(here, '../.output/chrome-mv3');
const backendDir = resolve(here, '../../backend');
const shots = resolve(here, '../../docs/screenshots');
const PORT = 8799;
const TOKEN = 'e2e-token';
const CHROME = process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const step = (s) => console.log(`• ${s}`);
const dbDir = mkdtempSync(join(tmpdir(), 'airdial-e2e-db-'));

const backend = spawn(join(backendDir, '.venv/bin/python'), [join(here, 'fake_backend.py')], {
  env: { ...process.env, PORT: String(PORT), DATABASE_URL: `sqlite:///${dbDir}/e2e.db` },
  stdio: ['ignore', 'inherit', 'inherit'],
});
const userData = mkdtempSync(join(tmpdir(), 'airdial-e2e-'));
let context;
let debugPanel;

async function waitHealthy() {
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${PORT}/health`)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('backend did not start');
}

try {
  await waitHealthy();
  step('backend up');

  context = await chromium.launchPersistentContext(userData, {
    executablePath: CHROME,
    headless: false,
    viewport: { width: 1100, height: 760 },
    args: ['--headless=new', `--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--no-sandbox'],
  });
  const fixture = readFileSync(join(here, 'whatsapp-fixture.html'), 'utf8');
  await context.route('https://web.whatsapp.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: fixture }));

  let [sw] = context.serviceWorkers();
  sw ??= await context.waitForEvent('serviceworker');
  const extId = new URL(sw.url()).host;
  step(`extension loaded (${extId})`);

  const wa = context.pages()[0] ?? (await context.newPage());
  await wa.goto('https://web.whatsapp.com/');
  await wa.waitForSelector('#pane-side [role=listitem]');

  const panel = await context.newPage();
  debugPanel = panel;
  await panel.setViewportSize({ width: 360, height: 720 });
  await panel.goto(`chrome-extension://${extId}/sidepanel.html`);
  mkdirSync(shots, { recursive: true });

  // Onboarding
  await panel.getByPlaceholder('Njavwa').fill('Njavwa');
  await panel.getByPlaceholder('Mutambo Beef').fill('Mutambo Beef');
  await panel.screenshot({ path: join(shots, '01-onboarding.png') });
  await panel.getByRole('button', { name: 'Continue' }).click();
  await panel.getByRole('button', { name: 'AirDial account' }).click();
  await panel.getByLabel('AirDial server').fill(`http://127.0.0.1:${PORT}`);
  await panel.getByLabel('Access token').fill(TOKEN);
  await panel.getByRole('button', { name: 'Continue' }).click();
  await panel.getByRole('button', { name: 'Continue' }).click();
  await panel.getByRole('button', { name: 'Start' }).click();
  const stored = await panel.evaluate(() => chrome.storage.local.get('settings'));
  if (stored.settings.userName !== 'Njavwa' || stored.settings.businessName !== 'Mutambo Beef') throw new Error(`onboarding lost fields: ${JSON.stringify(stored.settings)}`);
  step('onboarded');

  // Task
  await panel.getByLabel('What should I do?').fill('Reply to everyone who asked for prices today');
  await panel.screenshot({ path: join(shots, '02-home.png') });
  await panel.keyboard.press('Enter');
  await panel.getByText('Approve this action?').waitFor({ timeout: 30000 });
  await panel.bringToFront();
  await panel.screenshot({ path: join(shots, '03-approve-action.png') });
  step('approval gate shown for direct Send click');
  await panel.getByRole('button', { name: 'Deny' }).click();
  await panel.getByText('Drafted 1 reply for approval. Kouvas wants photos.').waitFor({ timeout: 30000 });
  await panel.screenshot({ path: join(shots, '04-task-done.png'), fullPage: true });
  const sentEarly = await wa.evaluate(() => window.__sent ?? []);
  if (sentEarly.length) throw new Error('message was sent before approval');
  step('task finished; nothing sent before approval');

  // Approval queue
  await panel.getByRole('button', { name: /Approve/ }).first().click();
  await panel.getByText('Muli bwanji Kouvas', { exact: false }).waitFor();
  await panel.screenshot({ path: join(shots, '05-approval-queue.png') });
  await panel.getByRole('button', { name: 'Approve', exact: true }).click();
  step('approved; sending at human pace');
  await wa.waitForFunction(() => (window.__sent ?? []).length > 0, null, { timeout: 60000 });
  const sent = await wa.evaluate(() => window.__sent);
  if (sent[0].name !== 'Kouvas' || !sent[0].text.startsWith('Muli bwanji Kouvas. T-bone ndi K120/kg')) throw new Error(`wrong send: ${JSON.stringify(sent)}`);
  step(`sent in WhatsApp Web: "${sent[0].text}"`);

  // Contact memory + summary
  await panel.bringToFront();
  await panel.getByRole('button', { name: 'Contacts' }).click();
  await panel.getByText('Kouvas').first().click();
  await panel.getByText('Can you send photos?').waitFor();
  await panel.screenshot({ path: join(shots, '06-contact.png'), fullPage: true });
  await panel.getByRole('button', { name: 'Today' }).click();
  await panel.getByText('cash expected', { exact: true }).waitFor();
  const sentKpi = await panel.locator('.kpi b').first().textContent();
  if (sentKpi !== '1') throw new Error(`summary shows ${sentKpi} sent`);
  await panel.screenshot({ path: join(shots, '07-today.png') });
  step('contact memory and daily summary updated');

  // Backend sync (background worker pushes after ~2s)
  let contacts = [];
  for (let i = 0; i < 30 && !contacts.length; i++) {
    await new Promise((r) => setTimeout(r, 500));
    contacts = await (await fetch(`http://127.0.0.1:${PORT}/v1/contacts`, { headers: { 'x-api-key': TOKEN } })).json();
  }
  if (contacts[0]?.name !== 'Kouvas' || contacts[0]?.stage !== 'quoted') throw new Error(`backend contacts: ${JSON.stringify(contacts)}`);
  let summary = {};
  for (let i = 0; i < 30 && summary.sent !== 1; i++) {
    summary = await (await fetch(`http://127.0.0.1:${PORT}/v1/summary/daily`, { headers: { 'x-api-key': TOKEN } })).json();
    if (summary.sent !== 1) await new Promise((r) => setTimeout(r, 500));
  }
  if (summary.sent !== 1) throw new Error(`backend summary: ${JSON.stringify(summary)}`);
  step(`backend synced: ${contacts.length} contact, summary sent=${summary.sent}, model cost $${summary.modelCostUsdThisMonth}`);

  // Dark mode render of the queue for the design review
  await panel.emulateMedia({ colorScheme: 'dark' });
  await panel.getByRole('button', { name: 'Home' }).click();
  await panel.screenshot({ path: join(shots, '08-home-dark.png') });

  console.log('\nE2E PASSED');
} catch (e) {
  console.error('\nE2E FAILED:', e);
  if (debugPanel) {
    await debugPanel.screenshot({ path: join(tmpdir(), 'airdial-e2e-failure.png') }).catch(() => {});
    const tasks = await debugPanel.evaluate(() => chrome.storage.local.get('tasks')).catch(() => null);
    console.error(JSON.stringify(tasks, null, 1)?.slice(0, 4000));
  }
  process.exitCode = 1;
} finally {
  await context?.close().catch(() => {});
  backend.kill();
  rmSync(userData, { recursive: true, force: true });
  rmSync(dbDir, { recursive: true, force: true });
}
