# Browser revolution acceptance

The fixture provider sends a full `revolve` recipe with a simple radius/height polygon. The actual browser Manifold worker creates the mesh. A second recipe widens the vase while preserving its entity ID and Y heights. The saved recipe and generated asset survive reload.

The export includes the exact generated GLB (verified against its SHA-256 hash) and the standalone player. A separate browser context renders those ZIP contents from a local HTTP server with external requests blocked. Astra inspected `standalone.png` after formation completed. There were no page errors or external requests.

Reproduce after building the worker/player artifacts:

```sh
node scripts/build-player.mjs
ORBSIE_MODELING_SHAPE=revolution node scripts/verify-browser-modeling-editor.mjs test-results/new-revolution-run
```

The editor defaults to `http://localhost:3047`; override `TEST_URL` if needed. Use a fresh output directory. The first integration attempt used an outdated prebuilt worker and rejected the new recipe; rebuilding resolved that mismatch.

This is synthetic provider evidence with real geometry, storage, export and rendering. It does not prove live model authoring, publication, gameplay, undo, or performance on representative GPUs. Full revolutions are supported; partial sweeps, arbitrary meshes and scripts remain separate work.
