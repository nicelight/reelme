# Prototype assets

- `egg.png`: generated with OpenAI Imagegen for this prototype. Source: `/home/serg/.codex/generated_images/01a1e55c-8b30-7113-97fb-a852b726d0b3/exec-1e031e88-cbd8-41d5-88c6-d97d87f1b47b.png`. Transparent amethyst ReelMe egg and pink orbit; accepted visual asset, approved 2026-11-17.
- `portraits.png`: generated with OpenAI Imagegen for this prototype. Source: `/home/serg/.codex/generated_images/01a1e55c-8b30-7113-97fb-a852b726d0b3/exec-a461dee6-69d4-4350-8586-211a9d1d7bda.png`. Nine illustrative cinematic portraits in a 3×3 sprite. These are not real visitor photos or frames of delivered videos.
- `fonts.css`, `manrope-*.woff2`: Manrope font served by `https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap`, downloaded locally for the prototype. Google returned TrueType font bytes; CSS correctly declares `format('truetype')` despite historical filename suffix.
- `../qr.json`: locally generated with the existing `qrcode` package. Each encodes only `ReelMe demo #NNN`. No receive URL or live result is represented.

Approved visual baseline and original card-light reference are preserved under `.tasks/design-results-prototype/`. Full initial references in `docs/DESIGN templates/` are Git-ignored; runtime assets here are not ignored. These files are in the workspace but have not been committed.
