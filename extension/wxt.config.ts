import { defineConfig } from 'wxt';

// No sites by default: the agent asks for each site the first time it needs
// it (or the user turns on "Allow on all sites"). Narrow permissions also
// help Chrome Web Store review. E2E builds add their fixture hosts.
declare const process: { env: Record<string, string | undefined> };
const E2E_HOSTS = (process.env.AIRDIAL_E2E_HOSTS ?? '').split(',').filter(Boolean);

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  srcDir: '.',
  manifest: {
    name: 'AirDial Agent',
    description: 'Keeps your conversations moving. Reads the chat, drafts the reply, follows up on time.',
    // debugger: real mouse/keyboard input and screenshots via the DevTools protocol.
    permissions: ['sidePanel', 'storage', 'alarms', 'tabs', 'scripting', 'notifications', 'debugger'],
    host_permissions: E2E_HOSTS,
    optional_host_permissions: ['<all_urls>'],
    action: { default_title: 'Open AirDial Agent' },
    commands: {
      _execute_action: {
        suggested_key: { default: 'Alt+A' },
        description: 'Open AirDial Agent',
      },
    },
  },
});
