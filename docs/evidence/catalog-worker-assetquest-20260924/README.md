# Eleven-asset catalog browser acceptance

The optimized local build ran `scripts/verify-catalog-worker-browser.mjs` with
`ORBSIE_CATALOG_WORKER_EVIDENCE_DIR` set to this directory. `report.json` records
11 successful cold-scene worker decodes, visible catalog geometry, a mixed
catalog/procedural export, direct and rebuilt standalone playback, and rejection
of catalog reuse under a new-only request. It observed zero real model calls,
external requests, or page errors. `full-catalog-diagnostic.json` confirms no
model-load messages. The images and ZIP are the resulting browser artifacts.

`pre-fix-diagnostic.json` and `.png` preserve the failing run: the final model
decoded successfully but the editor displayed a load error after cache eviction
before the first lease. The loader now holds a pending entry until all its
waiting consumers have acquired or abandoned leases. The test is synthetic
generation with real checked-in assets; it is not live-provider acceptance.

The exported two-object standalone image is still framed too distantly for
finished visual quality. That separate legibility issue remains open.
