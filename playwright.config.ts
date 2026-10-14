import { defineConfig, devices } from '@playwright/test';
import { config } from 'dotenv';
config({ path: '.env.local', quiet: true });
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: process.env.APP_ORIGIN ?? 'http://127.0.0.1:3100', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'mobile-chromium', use: { ...devices['Pixel 7'], viewport: { width: 360, height: 800 } } }],
  webServer: { command: 'pnpm start --hostname 127.0.0.1 --port 3100', url: 'http://127.0.0.1:3100', reuseExistingServer: !process.env.CI, timeout: 120_000 },
});
