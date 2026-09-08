# Cloud acceptance

Run: 2026-09-07T23:37:43.185Z
Target: https://orbsie.com

- Owned-site robots check: HTTP 404; bounded API acceptance run, two publications maximum.
- Accounts and publishing configuration enabled.
- Two synthetic Better Auth accounts authenticated; secrets stored only in ignored mode-0600 state.
- Saved flagship project 802ed9c1-c54d-4f35-8db2-7b4948b2780c, revision 64; GCS archive completed (archivePending=false).
- Authenticated list and reopen preserve flagship entities.
- Second user cannot read or overwrite the first user’s project (404).
- Stale cloud compare-and-swap rejected (409).
- FAIL: Publish: 502 {"error":"Vercel could not complete publication (403). Your previous release is safe."}

502 !== 200


Infrastructure diagnosis: the dedicated token can read the main Vercel project (HTTP 200), but creating a deterministic Orb project returns HTTP 403 with action `create`, resource `project`. Database and storage checks above completed successfully. No public deployment was created.

## Recovery race guards (2026-09-08)

Recovery now settles a running journal through cancellation, or rereads a terminal run, before accepting its current cloud-baseline flag and checkpoint identity. This prevents using an earlier successful baseline check after cancellation reports a conflicting save. The local installer captures the starting project object and refuses replacement if same-project edits arrive during asset download, local-copy preservation or the library write. Final account validity is a separate callback because intentionally opening another project invalidates the original project scope. Recovery also checks scope again before restoring UI state.

Two store regressions reproduced the old behavior before the fix: a late local edit was replaced, and an account change during final save still reported success. Additional tests verify successful cross-project opening, stale cancellation/terminal responses, latest terminal checkpoints and checkpoint identity. The full suite passed 432 tests with 7 explicit skips; production build and TypeScript checks passed. These are deterministic store/transport tests; no new live account, database, browser or provider recovery flow was run for this patch.

The cross-endpoint cloud-save race is addressed by the snapshot precondition described below: any intervening content change invalidates the token retained by recovery, even if its revision number is unchanged.

## Snapshot preconditions for cloud saves

Existing-world PUT requests now require both `baseRevision` and `baseSnapshotToken`. The server derives a canonical SHA-256 token from the stored snapshot and compares it under the same row lock as the update. GET/list/conflict responses and successful PUT acknowledgements return `snapshotToken`. The editor retains the pair when opening, saving, recovering or preparing a generation journal. New worlds still use a null baseline; older clients without a token receive a safe conflict rather than overwriting an existing world. No database migration is required.

The actual local authenticated API/database probe passed creation, a same-revision intervening write, stale-token rejection, missing-token rejection, unchanged remote content after rejection, and an explicitly rebased successful save. See `evidence/cloud-snapshot-cas/report.json` and `scripts/verify-cloud-snapshot-cas.mjs`. No inference, production requests or browser UI were exercised by that probe. Six route/hash tests and the full 438-test suite passed (7 explicit skips); build/typecheck passed. Review caught and removed recursive parsing of JSON-looking string fields, preserving distinctions such as titles “1” and “1.0”.

This protects current snapshot writes. The existing `orb_revisions` table still retains its first snapshot when an authored revision number is reused; this patch does not change that historical storage behavior. Browser conflict/recovery verification and deployment of these latest changes remain separate checks.
