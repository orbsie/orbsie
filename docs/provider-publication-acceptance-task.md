# Fresh provider publication identity acceptance

Bounded follow-up after provider story continuity review. Implement acceptance
verification, not republishing or changing historical worlds.

## Observed gap and files

`scripts/provider-browser-e2e.mjs::runPublication` observes published revision
and canvas, but not original project ID or exact player bytes. Existing public
revision1 can contain the obsolete WebGL-only player even though the current
editor uses Canvas2D fallback. `extractZip` already reads all files but returns
only names/project/tempDir. `src/lib/server/publication-artifact.ts` defines
publication-manifest.json with projectId, revision, per-file bytes/SHA-256;
`src/app/api/publish/route.ts` builds runtime/worker files from public/player.

Ownership: harness, a small scripts/lib verification helper if useful, focused
harness tests. Read these source points; do not re-investigate rendering. No
product/auth changes, no generated credentials, no live calls or deployment.

## Contract

- Preserve exact original project ID and undone revision across local refresh,
  ZIP, cloud save request and signed-out published project.json. Do not accept
  a same-revision different world. Messages are stripped for publication/export;
  compare relevant scene/game/environment fields according to production format.
- Bind fresh exported and published runtime.js, runtime.css and present geometry
  workers to the exact current target release artifacts. Record SHA-256/length
  evidence. Do not accept a manifest merely because its self-reported hashes are
  internally consistent; compare downloaded bytes to independent expected bytes.
- Restrict anonymous fetches to the already approved exact app/deployment origins,
  bounded duration/size, no auth headers/cookies, no external redirects. Preserve
  existing traffic guard and signed-out no-provider/editor-request checks.
- Keep source ZIP presence/rebuild evidence distinct from deployment files; current
  publication manifest need not grow just for this harness work.
- On missing/mismatched project/artifact, fail the requested publication phase and
  record a concise safe reason. Never report a full E2E pass from visible canvas.
- Tests should exercise actual comparison behavior: correct bytes, wrong ID with
  same revision, stale runtime, missing worker and malformed/oversized response.
  No source-string order tests. Run relevant tests/typecheck once after changes.

This does not implement physical traversal. Follow-up must reuse real inputs and
read-only telemetry in the same fresh provider world for collect/bounce/win/reset;
existing verify-saved-bounce-route.mjs only proves separate saved-world playback.
