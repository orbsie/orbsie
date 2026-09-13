# Same-world live gameplay acceptance

Pending bounded follow-up after publication identity checks. This document does
not claim implementation or a live pass.

## Source findings

`runFlagshipStory` in scripts/provider-browser-e2e.mjs verifies structure, UI
selection, edits and undo, but explicitly reports traversal unverified.
`scripts/verify-saved-bounce-route.mjs` uses fixed saved ZIP hashes/IDs and real
keyboard steering with rendered Three.js telemetry. It is useful prior evidence,
not proof for a new provider-created project. `verify-winning-traversal.mjs`
also has read-only player telemetry and touch input helpers; inspect before reuse.
`verify-software-game-actions.mjs` covers fixture action semantics; it does not
satisfy the live flagship sequence. SoftwareWorld uses the same GameSession and
stepGameplay, but draws to Canvas2D and has no Three.js scene to inspect.

## Required outcome

Run actual keyboard/touch inputs against the current page and original freshly
generated project, without reconstructing it, seeding undo history, teleporting
the player, forcing contacts or injecting score/win. Preserve three bounded model
calls (creation, selected mushroom edit, slower middle platform + two crystals).
Do not spend additional calls to make a failing route easier without reporting
that the original attempt failed.

- Show movement while generation is still in progress once controls are ready;
  record actual input, player movement and generation timestamps.
- Exercise moving/bouncy platforms, collect the actual five crystals, reach the
  portal, observe win, and reset via the real UI; verify avatar/score/objectives
  reset without replacing the project.
- Repeat relevant objective checks after the seven-crystal edit and original undo
  to five, then refresh/export/current-runtime signed-out publication. Bind all
  evidence to project ID/revision and actual geometry/game state.
- Adapt routes to observed generated geometry with bounded steering; unreachable
  objectives fail gameplay acceptance. Do not assume fixed entity IDs or one
  saved layout. Reuse semantic entity selection from the story validators.
- Support software and WebGL rendering. Prefer read-only renderer-neutral frame
  observations and user-visible HUD evidence; no mutable store exposure or
  application credentials in telemetry. A WebGL-only instrumentation build cannot
  prove production Canvas2D gameplay. Clearly label instrumented fixture coverage.
- Record input trace, contacts/collections, score/win/reset, renderer and actual
  elapsed/frame-time measurements. Never substitute a visible canvas/score-zero
  HUD for successful traversal. Keep desktop/touch emulation/physical-device
  claims separate.

Keep implementation cohesive and one Luna worker at a time. First select the
smallest reusable driver interface from existing tests, then wire it into the
fresh story. Targeted tests for route/observation logic; live runs only after
integration and approved provider auth are available. Owner-browser computer-use
journeys may supply real acceptance directly; do not export cookies to fit a
particular test harness transport.


## In-progress review2026-09-13

Single Luna worker owns the driver, harness wiring, copied observation bridge,
World/SoftwareWorld integration and minimal physics contact observations. Root
review required before commit. No live calls; new browser fixture run required.

Acceptance findings to resolve and cover before handoff:
- Count only the actual final selected top-surface landing/bounce, not nearby
  upward motion or superseded overlapping platform candidates. Retain bounded
  contact evidence across sampling intervals, and prove real platform movement.
- Observation data must be copied/read-only, internally accumulated and invalidated
  across project/revision/renderer/reset/session changes. Reject stale samples;
  avoid default telemetry allocations. Do not label clamped simulation deltas as
  measured frame-time percentiles.
- Movement during generation must use actual stream/journal completion, not HTTP
  header arrival. Permit monotonic incremental revisions for the same run and
  handle concurrent promise rejection immediately. No injected player/score state.

These notes are review criteria, not an assertion that the current WIP meets them.

## Follow-on integration gate after the creation driver passes

Source audit: `runFlagshipStory` currently traverses only creation. The goal7
phase checks persisted objectives and a zero-score HUD; original undo checks
restored data. `buildFreshGameplayTargets` requires exactly five collectibles.
These are explicit remaining gaps, not acceptance of the complete story.

Keep the same worker and wait for its current fixture handoff before assigning
this next bounded task. Ownership stays with the gameplay driver, story harness
and focused fixture/tests; no provider calls are required for implementation.

- Parameterize the expected objective count by the validated phase (five or
  seven), while resolving current IDs/positions from that committed revision.
  Do not reuse creation's five-object target list for the seven-object phase.
- After the real third response, traverse the seven-crystal world, verify its
  portal win and reset, then return to Edit and invoke the original UI Undo.
  Traverse the restored five-crystal world and reset before refresh/export.
  Preserve the selected mushroom edit and the same project throughout.
- Persist separate gameplay evidence per phase with revision, expected and
  collected IDs, actual inputs, win and reset. Structural success alone must
  not mark these phases gameplay-passed. Reject unreachable targets without
  model retries, teleportation or changes to the generated world.
- Exercise deterministic five → seven → original undo → five fixtures with
  actual inputs and both renderers. Cover wrong counts, stale target IDs and
  unintended lifecycle changes with targeted tests.
- Fresh signed-out publication playback is a further integration gate: adapt
  controls to the standalone UI and bind evidence to the verified published
  revision/artifacts. Editor traversal or a visible published canvas cannot
  substitute for signed-out movement, collection, portal win and restart.

Only after local integration passes, run the already authorized fresh three-call
Luna journey for each available provider. Keep OAuth/subscription login evidence
separate from API-key generation and preserve each credential's call/output cap.

## Product keyboard focus follow-up

Run8 established that Space never reached physics while the Play button retained
focus. Both renderer handlers intentionally preserve native Space/Enter button
activation, and Orbsie's Play handler currently changes state and closes the
mobile sheet without moving focus. The accepted driver explicitly clicks the
gameplay surface; that does not close this product usability gap.

After the software transition correction, give the game a named focus target and
transfer focus on an explicit Play action so immediate movement/jump works for
mouse and keyboard users. Preserve normal button activation, typing isolation,
visible keyboard focus and the ability to Tab back to editor controls. Avoid
focus stealing on ordinary model updates, geometry commits or window resize.
Validate Play → Space jump without the harness's extra canvas click, then focus
the composer and prove typing does not move the player. Cover both renderers and
leave existing pointer/touch control behavior intact.

## Route timing correction before the next live story

Root reviewed the recorded run12 software trajectory. Platform B contact was
observed, but the sample labeled `landing` was still airborne at y=2.709 with
velocityY=-0.748 and no groundedOn. The driver then approached C too late in
that jump. At C it was below the required top surface, fell to ground, and
repeated ground jumps that could not reach that height. This failure is retained
in `fresh-flagship-gameplay-fixture-run12-software-transition/report.json`.

Before the seven/undo traversal integration, make elevated-route transitions
depend on current support and jump phase rather than historical contact counts
plus fixed delays. Release jump after contact, recover stable support on the
preceding reachable platform, then initiate a fresh jump toward the next one.
If support is lost, use a bounded recovery route; do not repeat impossible
ground jumps or alter the generated platform layout. Keep trace labels factual:
an arbitrary post-wait observation must not be called a landing or apex unless
the recorded motion supports that event.

Validate the observed failure with targeted controller cases, then one meaningful
browser traversal under the affected timing conditions. Do not replace the hard
three-contact/bounce gate or discard failed live attempts. The current creation
fixture pass proves one successful route; it does not establish timing robustness.
