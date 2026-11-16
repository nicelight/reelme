import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: '.', testMatch: 'smoke.spec.ts', workers: 1, timeout: 120_000, reporter: 'list', outputDir: './browser-results', use: { browserName: 'chromium', channel: 'chromium', headless: true, viewport: { width: 1440, height: 1000 }, trace: 'off', screenshot: 'only-on-failure' } });
