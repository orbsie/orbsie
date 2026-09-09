# Scene hierarchy integration checkpoint

Implementation source: `caeb0c6` (tested before committing that same tree).
Production build and typecheck passed. The combined protocol, model-schema,
asset-policy, gameplay and game-session targeted run passed 73 tests. Review
subsequently strengthened cycle atomicity and recovery through actual operations;
the worker reran all eight hierarchy tests and typecheck successfully.

`scene-hierarchy-browser-initial` is a deterministic shared-world browser
fixture. A child has local position [10,0.5,0] beneath a parent translated
[-10,0,5], placing it beside the player at world [0,0.5,5]. Actual gameplay
collects it and wins. The screenshot was inspected. No external requests,
mutations or page errors occurred. This initial run predates the harness's
reload assertion.

`../scene-hierarchy-standalone` preserves a failed harness attempt: the local
fixture server served world.json while the player requests project.json.
`../scene-hierarchy-standalone-corrected` passed with that path corrected,
including player readiness and reload. It serves the actual built player files
and fixture project from an isolated local origin; it does not exercise ZIP
creation, publication or a live provider. Its screenshot was also inspected.

These checks prove a basic parented gameplay path, not the full acceptance
milestone. Editor-driven group revisions during play, targeted child edits,
undo/redo, cloud journal recovery, ZIP export and model-authored grouping remain
to be verified. Hierarchy operations are deliberately absent from the advertised
model schema until those integration gates pass. No production deployment was
made for this checkpoint.
