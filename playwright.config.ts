import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser', use: { baseURL: 'http://127.0.0.1:4174', headless: true, viewport: { width: 1360, height: 900 } },
  webServer: { command: 'npx tsx tests/ui-fixture.ts', url: 'http://127.0.0.1:4174/chat', reuseExistingServer: !process.env.CI },
});
