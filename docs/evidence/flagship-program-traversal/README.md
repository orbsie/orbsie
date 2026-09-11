# Flagship `project.game` traversal

This evidence covers the saved standalone snapshot at
`docs/evidence/provider-e2e/flagship-openrouter/openrouter/world.zip`. It is a
local replay of that exact ZIP through its bundled standalone runtime. It does
not claim a current live OpenRouter or hosted ChatGPT E2E run.

The verifier command was:

```sh
WIN_GAME_ZIP=docs/evidence/provider-e2e/flagship-openrouter/openrouter/world.zip \
WIN_OUTPUT=docs/evidence/flagship-program-traversal \
node scripts/verify-winning-traversal.mjs
```

The snapshot is revision 30, titled “A pocketful of sunshine”, and contains
the five unique collection IDs `crystal-1`, `crystal-2`, `crystal-3`,
`crystal-4`, and `crystal-5`, plus portal ID `portal`. Its six-rule
`project.game` contains one collect rule for each crystal and a portal
collision rule that wins when the `crystals` variable is 5. The verifier checks
that contract before opening the runtime.

The final bounded run passed on desktop keyboard and mobile touch. Each mode
recorded HUD scores 1, 2, 3, 4, and 5 at the five crystal checkpoints, then
the portal checkpoint at score 5 showed `Adventure complete`. Clicking the
runtime Restart control returned the HUD to `Score: 0` and removed the win
status in both modes. The report records empty page-error, external-request,
and mutating-request arrays, and zero inference calls. The desktop viewport
was 1440×1000; the touch viewport was 390×844.

The exact snapshot and runtime hashes are in [report.json](./report.json):

- ZIP SHA-256: `4675d2a0eed88f143cbc718a8c9178be554e21989841dbb6b11d89c42bbc36da`
- `project.json` SHA-256: `fdaabbd42a80478b3395e9220d5385706d646f457e523e2a7010ece3d47837a0`
- `runtime.js` SHA-256: `3d2fa966dc49a46eee64bd453e4db5861f57b565d71ec953f26b05c8ae4c7742`
- `runtime.css` SHA-256: `0174f4a45f76e1adaa103d5f1275bdbe1ae1c5e4fe710849428b16940b152e76`

The run used real keyboard and touch input. It did not import the store,
write score or transforms, or inject gameplay state. The verifier's player
position hook is read-only. Direct support state is not exposed by the saved
runtime, so the report explicitly records `directSupportObserved: false` and
does not claim that a moving platform was landed on or carried the player.
The position samples stayed at ground height around every checkpoint.

An earlier combined run is retained in
[failed-touch-portal-attempt.json](./failed-touch-portal-attempt.json). It
collected all five crystals but the original touch steering stopped around
0.38 units from the portal without an `Adventure complete` HUD; no source
mechanics or snapshot were changed. The final verifier only accepts that
portal step after the actual win HUD is visible.
