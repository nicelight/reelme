# Browser QA — TASK-001

2026-11-14. Chromium 159 / Playwright 1.65.1, actual built app and temporary SQLite/media directory. `npm run build` passed; `npm run test:ui` passed (1 end-to-end test, final run 9.2 s). Test fixture starts setup CLI/server, restarts with the same data, and cleans temporary data and both servers.

Verified through UI:
- Anonymous and operator views do not render the editor; administrator can log in/out. Operator session survives reload.
- Missing thumbnail/video/prompt produces actionable validation. Recast prompt is disabled.
- Admin saves V2V Recast with real PNG + 5-second H.264 MP4, and P2V with three PNG references and no demo. After setup and server restart, both records reopen with retained materials; media HTTP read succeeds.
- List displays thumbnail and exactly first three description words. Visibility change persists after restart.
- All 11 models have expected mode, prompt requirement, reference hint and resolution options; models without resolution input show no selector.
- Desktop 1280 px and mobile 375 px screenshots visually inspected: readable fields and controls, no clipping/overlap/horizontal overflow. Save control accessible at narrow width.
- Real cloud capture JavaScript and CSS load in a separate local HTTP origin; page remains `http://localhost:5513` and Svelte renders its entrypoint.

No page exceptions or unexpected HTTP failures. Console contains only expected anonymous session 401 and missing favicon 404 (URLs recorded in browser-observations.json). Favicon is cosmetic and does not affect these flows.

Artifacts: browser-desktop.png, browser-mobile.png, browser-capture.png, browser-observations.json. Reproduction: `npm run build && npx playwright install chromium && npm run test:ui`; ports 3197 and 5513 must be free. Browser tests require ffmpeg on PATH.

Scope: localhost:5513 uses the delivered HTML served by a minimal HTTP fixture; this proves browser loading/CORS and does not claim digiCamControl/Canon hardware validation. Server-side access/expiry/model-invalid-input checks are covered separately by API tests. No external provider calls performed.
