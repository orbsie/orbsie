# Traversal multitouch evidence

This bounded local browser check exercised the shared traversal touch driver
against the saved OpenRouter flagship ZIP at `390x844` with Chromium CDP touch
emulation (`maxTouchPoints: 5`). The ZIP was served by an isolated local HTTP
server; nonlocal requests and all mutating requests were blocked. No model,
inference, account, or provider calls were made.

The check observed trusted browser `pointerdown`/`pointerup` events for three
distinct pointers (Right, Back, Jump), verified that releasing Jump preserved
both held movement pointers, observed continued diagonal player movement after
Jump release, and released all pointers during cleanup.

Reproduce from the repository root with:

```sh
node docs/evidence/traversal-multitouch/browser-check.mjs
```

Provenance:

- Source ZIP: `docs/evidence/provider-e2e/flagship-openrouter/openrouter/world.zip`
- Source ZIP SHA-256: `4675d2a0eed88f143cbc718a8c9178be554e21989841dbb6b11d89c42bbc36da`
- Driver helper: `scripts/lib/traversal-touch-input.mjs`
- Driver helper SHA-256: `4434ebcb5fbc2802eb489647a9ca577ed928d20a2f10aea45f51c7512af94a70`
- Result: `report.json`; visual capture: `trusted-multitouch.png`; video: `trusted-multitouch.webm`
