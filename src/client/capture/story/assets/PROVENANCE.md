# Capture story assets

- `reelme-mark.png`: transparent gold R/play extracted from the avatar supplied by the operator and approved in the story prototype. No sample portrait or sample video is shipped here.
- `fonts.css`, `manrope-*.woff2`: local Manrope weights 400–800 copied from the approved prototype; original source is Google Fonts (`https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap`). The historical `.woff2` filenames contain TrueType bytes, matching the CSS format declaration.

The production component loads every story image/video through the authenticated catalog media endpoint. Artwork and motion were transferred from `../../story-prototype/` as a local snapshot; production does not import the prototype.
