// Live run against the real Claude API: the built extension in Chromium, the
// fixture shop site, and your own key (direct mode). Costs a few cents.
//
//   ANTHROPIC_API_KEY=sk-ant-... npm run e2e:live
//
// The agent gets a plain-language task; prompts that need approval are
// allowed automatically. Passes when the form arrives with the right fields
// via real (trusted) input and the password field stayed empty.

import { chromium } from 'playwright-core';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const key = process.env.ANTHROPIC_API_KEY;
if (!key) {
  console.error('Set ANTHROPIC_API_KEY');
  process.exit(2);
}
const here = dirname(fileURLToPath(import.meta.url));
const ext = resolve(here, '../.output/chrome-mv3');
const SHOP = 'https://shop.airdial-e2e.test/';
const CHROME = process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const userData = mkdtempSync(join(tmpdir(), 'airdial-live-'));
const context = await chromium.launchPersistentContext(userData, {
  executablePath: CHROME,
  headless: false,
  viewport: { width: 1100, height: 760 },
  // Sandboxed environments reach the internet through an egress proxy.
  ...(process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY, bypass: '127.0.0.1,localhost' } } : {}),
  args: ['--headless=new', `--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--no-sandbox'],
});
let code = 1;
try {
  await context.route(`${SHOP}**`, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: readFileSync(join(here, 'shop-fixture.html'), 'utf8') }));
  let [sw] = context.serviceWorkers();
  sw ??= await context.waitForEvent('serviceworker');
  const extId = new URL(sw.url()).host;
  const shop = context.pages()[0] ?? (await context.newPage());
  await shop.goto(SHOP);
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 360, height: 720 });
  await panel.goto(`chrome-extension://${extId}/sidepanel.html`);
  await panel.evaluate(async ({ apiKey, model }) => {
    const { settings = {} } = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({
      settings: { ...settings, onboarded: true, userName: 'Njavwa', businessName: 'Mutambo Beef', gateway: { mode: 'direct', agentMode: 'best', apiKey, backendUrl: '', backendToken: '', model, effort: 'medium' } },
    });
  }, { apiKey: key, model: process.env.MODEL ?? 'claude-opus-5-5' });
  await panel.reload();
  await panel.getByLabel('What should I do?').fill(
    'Go to the Lusaka Meat Co. tab and use its contact form to ask whether they deliver mince to Kabulonga. Use the name Njavwa and the email njavwa@example.com, and pick Mince as the product.',
  );
  await panel.keyboard.press('Enter');
  const deadline = Date.now() + 240_000;
  for (;;) {
    if (Date.now() > deadline) throw new Error('timed out');
    const status = await panel.locator('.status').first().innerText().catch(() => '');
    const allow = panel.getByRole('button', { name: /^(Allow|Allow this site)$/ });
    if (await allow.count()) {
      console.log('• approving:', (await panel.locator('.card.needs').innerText()).replace(/\s+/g, ' '));
      await panel.bringToFront();
      await allow.first().click();
    }
    if (/Done|problem|Stopped/.test(status)) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.log('--- panel ---\n' + (await panel.locator('main').innerText()));
  const subs = await shop.evaluate(() => window.__submissions ?? []);
  console.log('submissions:', JSON.stringify(subs));
  const s = subs[0];
  if (s?.trusted && s.name === 'Njavwa' && s.email === 'njavwa@example.com' && s.product === 'mince' && /kabulonga/i.test(s.message) && !s.pw) {
    console.log('\nLIVE PASSED');
    code = 0;
  } else console.log('\nLIVE FAILED');
} catch (e) {
  console.error('LIVE ERROR:', e);
} finally {
  await context.close();
  rmSync(userData, { recursive: true, force: true });
  process.exit(code);
}
