import { defineConfig } from 'wxt';

// Hosts the agent may act on out of the box (PRD default allowlist + LinkedIn).
// Everything else is requested per site at runtime so Web Store review sees
// narrow permissions.
export const DEFAULT_HOSTS = [
  'https://web.whatsapp.com/*',
  'https://mail.google.com/*',
  'https://docs.google.com/*',
  'https://www.linkedin.com/*',
];

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  srcDir: '.',
  manifest: {
    name: 'AirDial Agent',
    description: 'Keeps your conversations moving. Reads the chat, drafts the reply, follows up on time.',
    permissions: ['sidePanel', 'storage', 'alarms', 'tabs', 'scripting', 'notifications'],
    host_permissions: DEFAULT_HOSTS,
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
