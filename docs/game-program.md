# Composable gameplay implementation

The project format now accepts an optional `game` program. Programs contain bounded variables and ordered rules with triggers, conditions and actions. `set_game` replaces the entire program; `game: null` removes it. Existing worlds without this field retain their legacy behaviors.

Finish the geometry of every referenced object before installing rules. A referenced object cannot be removed or downgraded to coarse geometry: replace or clear its rules first. Refined geometry and material/transform edits preserve the program. Imported projects and committed checkpoints validate these dependencies too.

The pure engine supports start, click, collision, collection, input and timer events; variable and score conditions; variable updates, scoring, outcomes, reset, color, visibility, position and movement paths. Execution has explicit numeric, rule, action and timer catch-up bounds and executes no model-supplied code. Runtime state is separate from the saved program.

## Runtime integration and evidence

One scene-owned session feeds the player frame loop. It queues discrete keyboard/touch input edges and clicks so short taps survive delayed frames, and handles collision and collection events, timers, resets and program edits without storing per-frame runtime state in project data. Rendering and physics consume the same position and visibility overrides. Hidden objects are excluded from raycasting. Program score and win/loss feedback are shown in the editor and standalone player; legacy portal victory applies only without a program.

`docs/evidence/game-program/report.json` records a deterministic-generation browser run against the production build and its actual downloaded ZIP. It verifies collection/timer/input scoring, held-input deduplication, win, loss, restart, preserved program/source, and standalone playback with no external requests or page errors. The screenshots were visually inspected. This is fixture transport with real runtime execution, not live provider evidence. The full automated suite at this integration passed 392 tests, with three opt-in tests skipped.

Collision triggers use broad-phase axis-aligned bounds derived from the rendered geometry, including multipart transforms and catalog/generated metadata. Pickups and legacy portals use these 3D contacts too, so walking underneath elevated objects does not collect them or complete the game. The avatar contact extent is 0.22 horizontally and 0.42 vertically, with a small floating-point tolerance. These are contact volumes, not triangle-accurate collision response. Procedural contact bounds are cached by geometry recipe after initial preparation; moving that initial preparation off the main thread and measuring performance remain open.

## Remaining delivery gates

- Prove program persistence through browser local recovery and live cloud checkpoints, including edits during play.
- Extend browser evidence to click rules, movement paths, color/visibility changes and collision-driven resets, beyond their current unit/integration coverage.
- Measure responsiveness under representative object/rule counts and active background modeling.
- Run real provider-authored game flows with the authorized OpenRouter, Vercel AI Gateway and ChatGPT configurations.

This document tracks an implementation in progress, not a completed gameplay release.

## Live-provider observations

OpenRouter Luna/512 and local ChatGPT Astra-low each authored the requested rules and passed editor gameplay on a deterministic starter scene. Their saved programs also pass independent playback; reports distinguish original live attempts from replays. Standalone startup and short-input failures found during these checks were fixed with an explicit ready signal and queued input edges. A later OpenRouter request was interrupted by the provider and remains recorded as failed. See `docs/evidence/game-program-openrouter/README.md` and `docs/evidence/game-program-chatgpt/README.md` for exact scope and retained failures. Gateway gameplay, full live scene creation, recovery and publication remain unverified for this feature.

Collision target preparation is now restricted to IDs subscribed by game rules; ordinary worlds avoid unused contact geometry work. The CPU-only probe and collision-scoring browser evidence are described in `docs/evidence/contact-budget/README.md`. This does not establish the rendering responsiveness budget.
