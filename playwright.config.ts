import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests', testMatch: '*.spec.ts', workers: 1, fullyParallel: false,
  timeout: 60_000, reporter: 'list', outputDir: process.env.REELME_BROWSER_ARTIFACTS ? `${process.env.REELME_BROWSER_ARTIFACTS}/browser-results` : '.tasks/TASK-001-T3-FT-001-W1/browser-results',
  use: { browserName: 'chromium', channel: 'chromium', headless: true, trace: 'off', screenshot: 'off' },
});
