import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './demo/e2e',
  fullyParallel: true,
  workers: 2,
  timeout: 30_000,
  use: { baseURL: 'http://127.0.0.1:4173', browserName: 'chromium', viewport: { width: 1280, height: 900 }, trace: 'retain-on-failure' },
  webServer: { command: 'pnpm preview:demo --port 4173', url: 'http://127.0.0.1:4173', reuseExistingServer: !process.env.CI },
});
