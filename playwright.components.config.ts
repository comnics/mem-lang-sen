import { defineConfig } from '@playwright/test';

// Real React components with mocked HTTP and Next navigation; no app server.
export default defineConfig({
  testDir: './tests/components',
  workers: 1,
  reporter: 'list',
  use: { channel: 'chrome', viewport: { width: 390, height: 844 } },
});
