// End-to-end test: the built extension in real Chromium, a fixture shop site
// that only reacts to trusted (real) input, and the real backend with a
// scripted model (e2e/fake_backend.py).
//
//   npm run e2e
//
// Checks: onboarding; real clicks by ref and by screenshot coordinates; the
// approval gate (denied on Send, allowed on Submit); a blocked password field;
// draft -> approval queue -> approve -> sent by the agent with real typing;
// form filling with a dropdown; contact memory; daily summary; backend sync.

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
const SHOP = 'https://shop.airdial-e2e.test/';
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
  const fixture = readFileSync(join(here, 'shop-fixture.html'), 'utf8');
  await context.route(`${SHOP}**`, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: fixture }));

  let [sw] = context.serviceWorkers();
  sw ??= await context.waitForEvent('serviceworker');
  const extId = new URL(sw.url()).host;
  step(`extension loaded (${extId})`);

  const shop = context.pages()[0] ?? (await context.newPage());
  await shop.goto(SHOP);
  await shop.waitForSelector('#contact');

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
  await panel.getByLabel('AirDial access token').fill(TOKEN);
  await panel.getByText('Advanced').click();
  await panel.getByLabel('AirDial server').fill(`http://127.0.0.1:${PORT}`);
  await panel.getByRole('button', { name: 'Continue' }).click();
  await panel.getByRole('button', { name: 'Continue' }).click();
  await panel.getByRole('button', { name: 'Start' }).click();
  const stored = await panel.evaluate(() => chrome.storage.local.get('settings'));
  if (stored.settings.userName !== 'Njavwa' || stored.settings.businessName !== 'Mutambo Beef') throw new Error(`onboarding lost fields: ${JSON.stringify(stored.settings)}`);
  step('onboarded');

  // Task 1: read, real clicks (ref + coordinates), approval gate, draft
  await panel.getByLabel('What should I do?').fill('Reply to Kouvas on the shop page');
  await panel.screenshot({ path: join(shots, '02-home.png') });
  await panel.keyboard.press('Enter');
  await panel.getByText('Approve this action?').waitFor({ timeout: 30000 });
  await panel.bringToFront();
  await panel.screenshot({ path: join(shots, '03-approve-action.png') });
  const log1 = await shop.evaluate(() => window.__log);
  if (!log1.some((l) => l.reveal === true)) throw new Error(`coordinate click was not trusted: ${JSON.stringify(log1)}`);
  step('real click at screenshot coordinates registered (isTrusted)');
  step('approval gate shown for direct Send click');
  await panel.getByRole('button', { name: 'Deny' }).click();
  await panel.getByText('Drafted 1 reply for approval. Kouvas wants photos.').waitFor({ timeout: 30000 });
  await panel.screenshot({ path: join(shots, '04-task-done.png'), fullPage: true });
  if ((await shop.evaluate(() => window.__sent ?? [])).length) throw new Error('message was sent before approval');
  step('task finished; nothing sent before approval');

  // Approval queue -> browser task sends it with real typing + click
  await panel.getByRole('button', { name: /Approve/ }).first().click();
  await panel.getByText('Muli bwanji Kouvas', { exact: false }).waitFor();
  await panel.screenshot({ path: join(shots, '05-approval-queue.png') });
  await panel.getByRole('button', { name: 'Approve', exact: true }).click();
  step('approved; agent is sending it');
  await shop.waitForFunction(() => (window.__sent ?? []).length > 0, null, { timeout: 60000 });
  const sendLog = (await shop.evaluate(() => window.__log)).find((l) => 'send' in l && l.text);
  if (!sendLog.send || !sendLog.trustedTyping || !sendLog.text.startsWith('Muli bwanji Kouvas. T-bone ndi K120/kg')) throw new Error(`send not real: ${JSON.stringify(sendLog)}`);
  step(`sent with real typing and click: "${sendLog.text}"`);
  await panel.bringToFront();
  await panel.getByRole('button', { name: 'Approve' }).first().click();
  await panel.getByText('Sent', { exact: true }).waitFor({ timeout: 30000 });

  // Task 2: form with real typing, dropdown, blocked password, approved submit
  await panel.getByRole('button', { name: 'Home' }).click();
  await panel.getByLabel('What should I do?').fill('Fill in the contact form on the shop: ask if they deliver mince to Kabulonga');
  await panel.keyboard.press('Enter');
  await panel.getByText('Approve this action?').waitFor({ timeout: 30000 });
  await panel.bringToFront();
  await panel.getByRole('button', { name: 'Allow' }).click();
  await panel.getByText("Sent the enquiry. They'll reply by email.").waitFor({ timeout: 30000 });
  await panel.screenshot({ path: join(shots, '06-form-task.png'), fullPage: true });
  const subs = await shop.evaluate(() => window.__submissions);
  const sub = subs?.[0];
  if (!sub || sub.name !== 'Njavwa' || sub.email !== 'njavwa@example.com' || sub.product !== 'mince' || sub.message !== 'Do you deliver to Kabulonga?' || sub.pw)
    throw new Error(`form submission wrong: ${JSON.stringify(subs)}`);
  step('form filled with real typing + dropdown, password blocked, submit approved');

  // Provider outage: the customer sees AirDial wording, never the vendor's billing error
  await panel.getByRole('button', { name: 'Home' }).click();
  await panel.getByLabel('What should I do?').fill('Summarise this page (simulate outage)');
  await panel.keyboard.press('Enter');
  await panel.getByText('AirDial Agent is busy right now. Please try again in a minute.').first().waitFor({ timeout: 60000 });
  const shown = await panel.locator('main').innerText();
  if (/credit|balance|anthropic|scripted/i.test(shown)) throw new Error(`vendor error leaked: ${shown}`);
  await panel.screenshot({ path: join(shots, '07-outage.png') });
  step('provider outage shows AirDial wording only');

  // Contact memory + summary
  await panel.getByRole('button', { name: 'Contacts' }).click();
  await panel.getByText('Kouvas').first().click();
  await panel.getByText('Quoted K120/kg for 50 kg').waitFor();
  await panel.screenshot({ path: join(shots, '08-contact.png'), fullPage: true });
  await panel.getByRole('button', { name: 'Today' }).click();
  await panel.getByText('cash expected', { exact: true }).waitFor();
  const sentKpi = await panel.locator('.kpi b').first().textContent();
  if (sentKpi !== '1') throw new Error(`summary shows ${sentKpi} sent`);
  await panel.screenshot({ path: join(shots, '09-today.png') });
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
  await panel.screenshot({ path: join(shots, '10-home-dark.png') });

  console.log('\nE2E PASSED');
} catch (e) {
  console.error('\nE2E FAILED:', e);
  if (debugPanel) {
    await debugPanel.screenshot({ path: join(tmpdir(), 'airdial-e2e-failure.png') }).catch(() => {});
    console.error('--- panel ---\n' + (await debugPanel.locator('main').innerText().catch(() => '')).slice(0, 3000));
  }
  process.exitCode = 1;
} finally {
  await context?.close().catch(() => {});
  backend.kill();
  rmSync(userData, { recursive: true, force: true });
  rmSync(dbDir, { recursive: true, force: true });
}
