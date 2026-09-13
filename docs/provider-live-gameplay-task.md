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
