# Production standalone camera release

Source `f8ff99d` deployed Ready as `dpl_457wh7ZngJYaawrKwyfkW8HT16B9` at
`https://orbsie.com/` (immutable
`https://orbsie-h0y0goq6a-grappeggias-projects.vercel.app`). Production `/`,
`/player/runtime.js`, and `/player/source.json` returned HTTP 200. The latter
two response SHA-256 values match the checked-in built artifacts:

```
runtime.js  486d6c9447c3687ade2c2da28099e50e6b49f634456980cdb472eedc198ea82e
source.json 2eaf4a75200e31a3d237d8b81b003dfd68620f62e3aefd49593af7115f2456d5
```

The exact production frontend passed `scripts/verify-catalog-worker-browser.mjs`
with intercepted API calls. `report.json` records 11 asset loads, real browser
rendering, export, direct and built standalone playback, new-only catalog
rejection, and zero real model calls, external requests, or page errors. The
`built-standalone.png` view shows the closer starting camera with both subjects
visible. Same-ZIP desktop/mobile before-and-after screenshots are in
`docs/evidence/standalone-initial-camera-20260924/`.

This is a synthetic generation and browser-viewport check, not live-provider
or physical-device acceptance.
