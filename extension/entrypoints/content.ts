import { handle } from '../src/content/handler';
import { CONTENT_MESSAGE, type ContentCommand } from '../src/content/protocol';

// Injected on demand by the side panel (chrome.scripting) into tabs the user
// has allowed, rather than declared on every site.
export default defineContentScript({
  registration: 'runtime',
  // Only the default sites; others are injected after the user grants them.
  matches: ['https://web.whatsapp.com/*', 'https://mail.google.com/*', 'https://docs.google.com/*', 'https://www.linkedin.com/*'],
  main() {
    const w = window as unknown as { __airdialAgent?: boolean };
    if (w.__airdialAgent) return;
    w.__airdialAgent = true;
    chrome.runtime.onMessage.addListener((msg: { type?: string; command?: ContentCommand }, _sender, sendResponse) => {
      if (msg?.type !== CONTENT_MESSAGE || !msg.command) return;
      handle(msg.command).then(sendResponse);
      return true;
    });
  },
});
