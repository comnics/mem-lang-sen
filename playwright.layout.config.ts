import { defineConfig } from '@playwright/test';

// No server: these are CSS contract tests, not full-app or real-device checks.
export default defineConfig({
  testDir: './tests/layout',
  workers: 1,
  reporter: 'list',
  use: { channel: 'chrome', viewport: { width: 320, height: 568 } },
});
