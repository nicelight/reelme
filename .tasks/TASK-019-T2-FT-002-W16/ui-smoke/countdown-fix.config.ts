import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: '.', testMatch: 'countdown-fix.spec.ts', workers: 1, timeout: 60_000, reporter: 'list', outputDir: './countdown-fix-results', use: { browserName: 'chromium', channel: 'chromium', headless: true, viewport: { width: 1440, height: 1000 } } });
