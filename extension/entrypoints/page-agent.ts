import { handle } from '../src/content/handler';
import { CONTENT_MESSAGE, type ContentCommand } from '../src/content/protocol';

// Injected on demand by the side panel (chrome.scripting.executeScript) into
// tabs the user has allowed; never declared in the manifest.
export default defineUnlistedScript(() => {
  const w = window as unknown as { __airdialAgent?: boolean };
  if (w.__airdialAgent) return;
  w.__airdialAgent = true;
  chrome.runtime.onMessage.addListener((msg: { type?: string; command?: ContentCommand }, _sender, sendResponse) => {
    if (msg?.type !== CONTENT_MESSAGE || !msg.command) return;
    handle(msg.command).then(sendResponse);
    return true;
  });
});
