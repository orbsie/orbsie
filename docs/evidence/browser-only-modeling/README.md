# Browser-only modeling acceptance

The real Chromium editor and Manifold WebAssembly worker created an arch, widened its opening under the same entity ID, persisted it, and restored it after reload. Provider commands are deterministic fixtures; no live model calls were made.

The entry URL included a legacy `#builder=` link targeting a loopback endpoint. The app made no companion request. Both generation requests advertised `localModeling: false` and `browserModeling: true`. The harness blocks external HTTP requests (with a synthetic font response); no unexpected requests or page errors occurred.

Command: `node scripts/verify-browser-modeling-editor.mjs docs/evidence/browser-only-modeling`.

Astra inspected `reloaded.png`: the edited arch renders with the wider opening after resume. This verifies local browser construction/edit/reload, not the complete multi-provider live acceptance goal.
