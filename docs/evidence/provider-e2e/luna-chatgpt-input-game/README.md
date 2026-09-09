# Live Luna ChatGPT browser E2E

The managed ChatGPT companion selected exact catalog model `gpt-5.6-luna`, low reasoning, default processing. `wrapper.json` confirms two actual generation calls and child exit 0. No model fallback or intercepted generation was used.

The app was served from the existing production build at source `385b66206f7b827bdab9da1c5b7a9356f5c5a11b`, on http://127.0.0.1:3031. Harness changes select Luna explicitly and reject other models before inference. Reproduce:

```sh
ORBSIE_LIVE_E2E=1 ORBSIE_TEST_URL=http://127.0.0.1:3031 ORBSIE_EVIDENCE_DIR=docs/evidence/provider-e2e/luna-chatgpt-input-game node scripts/verify-chatgpt-authored-game.mjs
```

The initial scene contains two refined procedural objects, a tree and a mushroom, with no catalog reuse. Three input rules add score 7 on right, win on up, and lose on left. Creation emitted nine operations; first reservation was observed at 7,132 ms. The selected-object pink edit preserved other geometry, entities, environment and game rules. Local reload and ZIP export preserved the program. The independent exported player passed score, held-key deduplication, win, restart and loss checks, with zero page errors. Astra inspected the standalone win screenshot and the structured reports.

This validates the specified input-rule scene rather than the complete island flagship. It does not validate Blender construction, cloud recovery, interruption, OpenRouter/Gateway, or dedicated publication. The separate real local Blender CLI evidence is in `docs/evidence/agent-blender-runtime/`. Both broader provider and portable-runtime release gates remain open.
