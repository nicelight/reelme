# Browser evidence

- `npm run build`: PASS, including final CSS correction.
- `REELME_BROWSER_ARTIFACTS=.tasks/TASK-020-T2-FT-004-W17 npm run test:ui -- tests/results-screen.spec.ts`: PASS (1.9m). Real isolated backend: admin saves20s; operator-only access; empty→nine hatches with ordered side placement; decoded frame/QR before appearance; rendered QR resolves correct token; unique page IDs; arrivals wait nextpage; one hatch perpage; expired current card retained until boundary and excluded nextpage. See `production-results-observations.json`.
- Final `... npm run test:ui -- tests/display.spec.ts tests/results-screen.spec.ts`: stable-header test PASS17.7s, simulation PASS3.4s. Redundant queued core repeat deliberately interrupted on operator instruction to stop repetitive checks; original core PASS remains the evidence. Header changes do not alter results queue.
- Header evidence: stable positions, before/after hatch captions, ready replacement without shifting other rows, hide/StatusShow, safe failures only in operator control view. `production-progress-header.png` captured before the final image-height fix.
- Simulation fixture had outdated slot payload (400 on create); added required setup fields, retained no-key real worker regression.
- Viewing final header screenshot exposed4:3 image overflow. Fixed `.result` grid row/min-height; one final screenshot confirmed nine portraits remain inside cards. No whole-suite rerun. `final-production-preview.png` viewed, approved geometry/glows retained; header intentionally replaces approved title per later user instruction.
- All external generation/mail disabled or locally injected. Hardware performance/remote deployment not checked.

## Isolated preview

`http://127.0.0.1:3197/?screen=results`, accounts `operator` / `admin`, password `test-password`. This is an isolated temporary fixture, NOT real installation data. Nine synthetic sessions use stills from the supplied local video; two preparation rows. Fake mail transport, generation disabled. Process launched with `node --import tsx .tasks/TASK-020-T2-FT-004-W17/start-preview.mjs`; `preview-info.json` records temporary data directory. Ordinary production server port3000 was not running and was not started against real data.
