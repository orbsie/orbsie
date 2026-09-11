# Browser modeling feedback acceptance

This is a deterministic production-build browser run for the modeling-feedback
transport introduced by source `33148de`. The application changes under test
were committed at `33148de`; the verifier ran against checkout `HEAD` at
`54c09ec`, whose production build includes that source. The run used Chromium
with SwiftShader at `http://127.0.0.1:3077`, with
`BETTER_AUTH_URL=http://127.0.0.1:3077`.

Command:

```sh
TEST_URL=http://127.0.0.1:3077 node scripts/verify-modeling-feedback-browser.mjs docs/evidence/modeling-feedback-browser
```

The fixture intercepted only `POST /api/generate` and returned four bounded
NDJSON streams. Read-only config and trial/account endpoints were fulfilled
locally; unexpected API paths and all external HTTP requests failed the run.
No model credentials, provider inference, server-funded call, database write,
publication, cloud operation, or authentication flow was used.

The first stream created two `new-only` generated entities and the real browser
Manifold worker baked both GLBs. The second stream sent an overlapping
`compose` recipe for `feedback-target`; the worker rejected node `overlap`, the
visible error was recorded, and the stored target geometry/hash/ID plus the
unrelated entity were unchanged. The explicit fix request carried matching
`version`, project ID, entity ID, backend, node ID, error, and the 308-byte
rejected recipe. The third stream delivered a boolean `union` recipe, which
baked a new ready model under the same entity ID. A fourth fixture-only
follow-up returned only `commit_revision`; its request contained no
`modelingFeedback`, and both entity records remained unchanged.

The run passed with no page errors, blocked requests, or unexpected API calls.
The exact request summaries, hashes, model-byte digest checks, and assertions
are in [report.json](report.json). Screenshots show the created state
([created.png](created.png)), visible worker rejection
([invalid-feedback.png](invalid-feedback.png)), and successful correction
([corrected.png](corrected.png)).

This is fixture transport and real browser worker/editor acceptance. It does
not establish live provider authoring, cloud recovery, publication, or
cross-browser behavior.
