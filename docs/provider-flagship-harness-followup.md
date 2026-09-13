# Full provider journey harness follow-up

Source review at a0f51f0: `scripts/provider-browser-e2e.mjs` accepts fresh
`ORBSIE_FLAGSHIP_STORY=1` only for Gateway, budgets three calls, requires4096
output tokens and forbids publication/cloud-recovery combinations. Hosted
ChatGPT contract independently fixes two calls and correctly declares no provider
token/cost guarantee. These are earlier milestone restrictions, not evidence
that the full three-provider objective has been validated.

After the current rendering task, extend the fresh same-world story harness as
one bounded implementation task before claiming a full provider matrix. Owner
has authorized needed Luna calls; preserve explicit opt-in and per-run budgets.
Do not run live calls merely to test harness configuration.

- Support fresh OpenRouter, Gateway and hosted ChatGPT story runs with the same
  original prompts and actual model/provider identity assertions. Keep Luna-only
  test routing and no silent model substitution.
- Keep three explicit generation requests for creation, selected giant-pink edit,
  and slower-middle-platform plus two crystals; stop on failure without automatic
  retries. API-key providers retain4096 output-token caps. Hosted ChatGPT retains
  its actual180second/512KiB application response bounds and declares token cap
  unavailable; use a distinct three-call contract without weakening the existing
  two-call milestone contract.
- Retain one actual project and original revision history across playing during
  generation, selection, edits, live undo, refresh, export and publication. Permit
  these non-inference follow-on phases without regenerating/reconstructing the
  world or seeding undo history. A published test clone is separate evidence if
  it does not prove original project continuity.
- Treat provider auth as a separate gate: hosted subscription must come through
  owner computer-use browser consent; API-key tests do not prove OpenRouter OAuth.
  Do not export owner cookies or use local Codex credentials to unblock a harness.
  Computer-use may execute the journey directly when no authorized harness session
  transport exists; that does not excuse missing story phases.
- Unit/configuration tests must cover provider-specific bounds and rejected mixed
  modes before live execution. Report each phase and preserved IDs/revisions,
  real model-call count, artifacts and limitations. Physical mobile remains open.

Implementation review is in progress: all three provider configurations and
explicit hosted three-call bounds are implemented; a behavioral continuity
regression is being added. Structural checks are not gameplay acceptance. The next
hosted live milestone should still diagnose the post-fix create/edit route first;
full story acceptance follows successful actual generation.


## Remaining publication evidence gate

Source review of `runPublication` on 2026-09-13 found that it observes a visible
canvas and published revision, but does not bind the public snapshot's project ID
or runtime bytes to the original live world/current editor release. Production
observation `published-old-runtime-20260913/report.json` shows why this matters:
an old independent deployment still requires WebGL even though the current editor
has a software fallback.

The next bounded acceptance change must compare the original project ID and
revision through cloud save, exported snapshot and anonymous published snapshot;
compare the published runtime and workers with the exact exported/current-release
artifacts; retain hashes in the report; and reject stale or mismatched artifacts.
Use bounded anonymous fetches through approved deployment origins. Existing
publication manifests already describe project identity and SHA-256 file hashes;
reuse their format. This is verification of a fresh publication, not permission
to mutate historical user publications. Source ZIP retention and rebuild evidence
remain separate from the smaller deployed player artifact.

Actual movement, bounce traversal, collection, portal win and reset still need to
run in the same fresh provider-created world. A structural pass, visible canvas,
or separate reconstructed saved-world traversal cannot satisfy that requirement.
