import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: '.', testMatch: 'review.spec.ts', workers: 1, timeout: 90000, reporter: 'list', outputDir: './browser-results', use: { browserName: 'chromium', headless: true, viewport: { width: 1672, height: 941 } } });
