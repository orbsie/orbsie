# Scene hierarchy editor acceptance

This is deterministic browser evidence from `scripts/verify-scene-hierarchy-editor.mjs`. The Playwright context intercepts `/api/trial` and `/api/generate`; it makes no live provider, account, or external network call. The source metadata recorded in `report.json` is `runtime0870f83` for the app runtime and the current repository HEAD at the time of the run.

The fixture covers three bounded scenarios:

1. Create stable group and entity IDs for a generated browser-manifold box prop, collectible, platform, and unrelated entity. The prop, collectible, and platform are children of the group.
2. Submit keyboard input while Play is active, then edit the group translation and Y rotation. The authored entity IDs and geometry remain unchanged, and the Play HUD and scene caption are identical before and after the edit.
3. Select the prop through the visible object list and change only its generated recipe geometry. Undo, redo, reload, project ZIP hierarchy, baked GLB integrity, standalone readiness, and zero editor/external requests are checked.

The first run in `scene-hierarchy-editor-20260909/` failed on a strict comparison of an unrelated entity because structured-clone persistence retained an optional `assetPolicy: undefined` field. The harness now JSON-normalizes persisted comparisons where optional undefined fields are representation-only; the failure evidence remains preserved. The rerun in this directory passed all assertions.

The remaining gate is a separate gameplay milestone: this acceptance preserves the visible Play state and does not inject player or score transforms, but it does not claim that a player physically rides a platform through a rotated parent during motion. A browser test must observe that rotated-platform carrying behavior directly.
