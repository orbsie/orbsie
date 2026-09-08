# Composable gameplay implementation

The project format now accepts an optional `game` program. Programs contain bounded variables and ordered rules with triggers, conditions and actions. `set_game` replaces the entire program; `game: null` removes it. Existing worlds without this field retain their legacy behaviors.

Finish the geometry of every referenced object before installing rules. A referenced object cannot be removed or downgraded to coarse geometry: replace or clear its rules first. Refined geometry and material/transform edits preserve the program. Imported projects and committed checkpoints validate these dependencies too.

The pure engine supports start, click, collision, collection, input and timer events; variable and score conditions; variable updates, scoring, outcomes, reset, color, visibility, position and movement paths. Execution has explicit numeric, rule, action and timer catch-up bounds and executes no model-supplied code. Runtime state is separate from the saved program.

## Runtime integration and evidence

One scene-owned session feeds the player frame loop. It queues discrete keyboard/touch input edges and clicks so short taps survive delayed frames, and handles collision and collection events, timers, resets and program edits without storing per-frame runtime state in project data. Rendering and physics consume the same position and visibility overrides. Hidden objects are excluded from raycasting. Program score and win/loss feedback are shown in the editor and standalone player; legacy portal victory applies only without a program.

`docs/evidence/game-program/report.json` records a deterministic-generation browser run against the production build and its actual downloaded ZIP. It verifies collection/timer/input scoring, held-input deduplication, win, loss, restart, preserved program/source, and standalone playback with no external requests or page errors. The screenshots were visually inspected. This is fixture transport with real runtime execution, not live provider evidence. The full automated suite at this integration passed 395 tests, with three opt-in tests skipped.

Collision triggers use broad-phase axis-aligned bounds derived from the rendered geometry, including multipart transforms and catalog/generated metadata. Pickups and legacy portals use these 3D contacts too, so walking underneath elevated objects does not collect them or complete the game. The avatar contact extent is 0.22 horizontally and 0.42 vertically, with a small floating-point tolerance. These are contact volumes, not triangle-accurate collision response. Procedural contact bounds are registered from the renderer’s final mesh before formation morphing and cached by geometry recipe; pure physics callers retain a geometry-building fallback. This avoids rebuilding an already rendered mesh for contact checks. Catalog parsing/merging and generated geometry preparation now run in browser workers; the measured software-rendered background-modeling baseline does not yet meet the frame-rate target. See `docs/evidence/modeling-responsiveness/README.md`.

## Remaining delivery gates

- Prove program persistence through browser local recovery and live cloud checkpoints, including edits during play.
- Extend browser evidence to click rules, movement paths, color/visibility changes and collision-driven resets, beyond their current unit/integration coverage.
- Measure responsiveness under representative object/rule counts and active background modeling.
- Run real provider-authored game flows with the authorized OpenRouter, Vercel AI Gateway and ChatGPT configurations.

This document tracks an implementation in progress, not a completed gameplay release.

## Live-provider observations

OpenRouter Luna/512 and local ChatGPT Astra-low each authored the requested rules and passed editor gameplay on a deterministic starter scene. Their saved programs also pass independent playback; reports distinguish original live attempts from replays. Standalone startup and short-input failures found during these checks were fixed with an explicit ready signal and queued input edges. A later OpenRouter request was interrupted by the provider and remains recorded as failed. See `docs/evidence/game-program-openrouter/README.md` and `docs/evidence/game-program-chatgpt/README.md` for exact scope and retained failures. Gateway gameplay, full live scene creation, recovery and publication remain unverified for this feature.

Collision target preparation is now restricted to IDs subscribed by game rules; ordinary worlds avoid unused contact geometry work. The CPU-only probe and collision-scoring browser evidence are described in `docs/evidence/contact-budget/README.md`. This does not establish the rendering responsiveness budget.

The supported-player browser check now requires readiness, a visible score and no loading/error message. It caught an unconditional error callback from R3F’s canvas fallback: fallback markup mounts even when WebGL works. That callback was removed; actual renderer construction failures are reported explicitly because R3F initializes asynchronously outside the React error boundary. The pre-fix assertion failure is retained in `docs/evidence/game-program/failure.json`. The disabled-WebGL browser check verifies the real failure path independently.

Additional rendered browser coverage is recorded in `docs/evidence/game-actions/`: variable gates, click/color, hidden-object click suppression, position/path changes and restart in both editor and downloaded ZIP. `docs/evidence/game-rule-edits/` proves material edits preserve running score and changed rules restart with a visible notice. A restart counter preserves that notice through subsequent Blender progress messages. These runs use deterministic generation and do not add live-provider claims.

## Support-loss reconciliation

The gameplay/session regression reproduces a hidden support while score and timers are running: the previous runtime incorrectly allowed an airborne jump with vertical velocity +5.4. Support eligibility must be checked against the current usable platform and its footprint before applying jump input. A lost support releases the avatar into a normal fall to the parcel ground, preserving collected IDs, score and timers rather than resetting the game. `tests/gameplay-session-reconciliation.test.ts` covers this shared engine/session integration; it is not browser or real-provider evidence.

Reflected procedural platforms now use absolute horizontal extents and the maximum of both transformed vertical mesh endpoints. Four regressions first reproduced failed landing for negative X, Z, Y and combined scales, then passed landing and jumping after the fix. The prior-pose support height fallback uses the same transformed bounds, including for catalog and generated platforms. The existing horizontal collision margin is preserved.

Validation for support-loss reconciliation: 26 focused gameplay/session tests passed; the full suite passed 421 tests with 7 opt-in/artifact-dependent skips. The production build and TypeScript checks passed, including rebuilding the standalone player. The initial build caught a widened string literal in a new test fixture; correcting its type annotation resolved that build error. No new browser or provider flow was run for this patch.
