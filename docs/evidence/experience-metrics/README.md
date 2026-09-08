# Creation experience timing

The shared store and renderer record seven independent milestones in browser memory using `performance.now()`. `getExperienceMetrics(projectId?)` returns defensive snapshots of the latest 20 runs. No prompts, credentials, or message content are collected, and no telemetry request is sent. Reloading clears the history.

- Submission: the store accepts a generation run and creates its project state.
- Reservation: the first validated `reserve_entity` is applied (after durable acknowledgement when connected).
- Visible seed: the main camera completes a points draw during the early formation phase for an entity reserved in this run. Shadow-camera draws are excluded. This is a draw observation, not pixel visibility or occlusion certification.
- Controls: the player takes a simulation step with its input handlers ready while Play is active.
- Objective: Play is active, a win/lose rule or legacy portal exists, all referenced entities are usable and ready, and the game session has no error. This measures runtime readiness, not proof that every authored objective is reachable.
- Generation complete: the current, un-aborted store run successfully completes its validated stream.
- Publish ready: the publication poll reports READY with a served revision matching the current project revision.

Times are milliseconds relative to submission; an unobserved milestone remains null. Generation outcome and completion time are separate from later play/publication milestones. First observations are preserved. Tokens isolate superseded generation callbacks. Renderer and publication observations apply to the latest run for that project.

Validation: six focused metrics cases cover first-write/monotonic timing, stale tokens, bounded history, defensive snapshots, missing-project lookup, and failed/cancelled outcomes. Store journal tests additionally assert successful completion and stopped/incomplete-stream outcomes through real store execution. The formation browser fixture records seed and controls from the shared renderer, with synthetic submission/reservation setup and no objective, generation, or publication; those latter milestones correctly remain null. See `../formation-continuity/report.json`. This fixture is not a live provider E2E timing measurement.

Full provider E2E and publication latency acceptance remain separate release gates. The current browser uses SwiftShader; these observations do not certify normal GPU performance.

Scene-update follow-up: each applied reservation, geometry, material, transform or behavior revision starts a bounded draw observation after validation and any durable acknowledgement, immediately before updating the store. The renderer ends it on the first main-camera draw for that exact entity object. Catalog/generated asset placeholders do not end the observation while requested geometry is unavailable. Each run retains its latest 256 samples; revisions never drawn remain null, including revisions coalesced before rendering. Exact object identity prevents an old callback for the same entity ID from acknowledging a newer revision.

`acceptedAt`, `drawnAt` and `latencyMs` measure application-to-draw delay, including any remaining asset loading/preparation. They do not isolate worker-completion-to-draw delay, measure an input event's response, prove pixel visibility, or establish that the final morph has completed. The browser fixture records six actual procedural revisions through the shared renderer and reports whether their measured maximum meets 100 ms, without turning this small SwiftShader sample into a normal-device performance claim. It excludes the fixture's deliberately frozen/manual-render frames from this measurement.

The 2026-09-08 targeted run passed ten metrics tests, eight store journal tests, TypeScript and the renderer browser check. Six measured procedural revision draws ranged from 25.9 to 32.7 ms, below the 100 ms target for this fixture only. No provider calls or external requests occurred. Asset-loading, input-feedback and representative hardware/load measurements remain separate work.
