# TASK-003 — browser verification

2026-11-14. Delegated Chromium QA using project Playwright because `ui_qa` launcher is unavailable. Real built Svelte app, HTTP API and temporary SQLite; only digiCamControl HTTP responses are controlled fixtures.

Final commands: `npm run build` and `REELME_BROWSER_ARTIFACTS=.tasks/TASK-003-T2-FT-002-W2 npm run test:ui -- tests/camera.spec.ts tests/capture.spec.ts tests/editor.spec.ts`. Build PASS; browser **3/3 PASS, 54.4 s**. Logs: [build](verify-build.log), [browser](verify-browser.log). `git diff --check`: PASS.

## Observed results

- From catalog and real start API: Recast takes one photo, the next fixture visitor receives a different sessionId and takes four poses in server order. Five distinct JPEGs match fixture bytes exactly; old file is never selected. Camera/file requests contain no installation Authorization header.
- New JPEG appears only on the second file-list poll. A 503 downloading visitor 2's second frame shows «Повторить» and retains «Снято: 1 из 4». Retry downloads the identical path; shutter count remains unchanged. Final four positions contain the expected distinct originals.
- Live preview uses `matrix(-1, 0, 0, 1, 0, 0)`; captured images use `none`. Original asymmetric bytes are unchanged. Preview occupies over half the desktop viewport width. Successful LiveView followed by preview 503 falls back while retaining LiveView_Capture; unavailable LiveView at initial start falls back to Capture.
- Visible countdown is 3–2–1 for every attempt. WebAudio creates 3 oscillator starts for Recast and 15 for four poses plus one retry. Confirmation «Кадр снят ✓» and the four distinct pose instructions appear. Completion does not display a visitor number or claim successful upload.
- Catalog/start retry and admin/editor regression both pass, including persisted start receipt and lost acknowledgement recovery. No page errors.

Machine-readable observations: [camera-observations.json](camera-observations.json). Reviewed desktop preview, original confirmation, retry state and 375px fallback screenshots: [preview](camera-live-desktop.png), [original](camera-original.png), [retry](camera-retry.png), [mobile](camera-mobile-fallback.png). Text/buttons are readable, no horizontal overflow; mobile stacks the pose below the viewfinder.

## Corrections verified

Initial browser run exposed illegal native `fetch` receiver binding; a Chromium probe confirmed `TypeError: Failed to execute 'fetch' on 'Window': Illegal invocation`. The owner changed the adapter's default fetch wrapper. A subsequent successful run exposed a transient countdown 0 on retry; the owner initializes it to 3 before awaiting audio. Final strict countdown assertions pass. One intermediate run was interrupted for rebuild; final result above uses current source.

## Limits

No Windows/Canon/digiCamControl hardware or physical audio output was tested. Chromium runs headless with muted output: WebAudio execution is evidence of emitted audio nodes, not audibility at the installation. TASK-005 retains hardware acceptance. Between visitors the fixture clears sessionStorage and reloads; product finalize/release/upload and durable photos belong to TASK-004, and were not simulated as implemented. Browser reload recovery of Blobs is outside TASK-003.
