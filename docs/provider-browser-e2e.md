# Provider browser E2E harness

Current owner authorization: live tests call Luna only. The harness requires `gpt-5.6-luna` for ChatGPT or `openai/gpt-5.6-luna` for remote providers and rejects other IDs before browser/provider startup. This restriction does not apply to end users. Existing credential-specific caps remain in force. Historical Astra reports below describe past runs.

`scripts/provider-browser-e2e.mjs` is the opt-in acceptance harness for a real
browser session. It is separate from `scripts/verify-provider-ui.mjs` and the
other fixture checks: it never installs a route that fulfills `/api/generate`,
never imports the fixture transport, and never treats a snapshot as provider
evidence.

Standalone acceptance requires `main[data-ready=true]` for every scenario,
not only the input-rule fixture. Its network allowlist contains only the
temporary export origin: requests back to the editor also fail the check.
Reports retain the blocked request count and `readyObservedMs`, an upper
bound measured after navigation and readiness assertions, not an exact
first-frame latency. These strengthened checks apply to subsequent runs;
historical passing reports have not been retroactively revalidated.

`ORBSIE_REQUIRE_PROCEDURAL=1` adds a procedural-authoring acceptance gate.
It requires `ORBSIE_REQUIRE_BROWSER_MODEL=1`,
`ORBSIE_REQUIRE_NEW_ONLY=1`, `ORBSIE_REQUIRE_GEOMETRY_EDIT=1` and the existing
explicit creation/edit prompts. Creation must retain QuickJS source and a
source hash; editing must change both source and hash while the existing
geometry checks require a new recipe revision, a changed stored GLB and
preservation of unrelated state. Ordinary browser recipes cannot satisfy
this gate. All live-inference authorization and credential-specific token
caps still apply. This option is prepared for the integration milestone;
its existence is not evidence of a live procedural pass.

The harness fails closed before Chromium starts unless the caller explicitly
sets `ORBSIE_LIVE_E2E=1`, chooses `--provider openrouter`, `--provider gateway`,
`--provider free`, or `--provider chatgpt-local`, supplies an exact
`ORBSIE_EXPECTED_MODEL`, and
declares `ORBSIE_KEY_SCOPE=local-only` or `ORBSIE_KEY_SCOPE=cloud-authorized`.
It also requires a bounded `ORBSIE_OUTPUT_CAP_TOKENS` for API-key providers.
The target must be supplied as `ORBSIE_TEST_URL` (the existing `TEST_URL` name
is accepted for compatibility). A `local-only` key is rejected for any
non-loopback target. The key and, for ChatGPT local, the capability token are
read only after every gate passes; neither is logged, stored in the report, or
written to screenshots or ZIP evidence.

For API-key runs the harness waits for the live same-origin
`/api/models?provider=...` response, requires the exact expected model to be
present, selects its visible catalog row, fills the key in the in-memory
settings control, and verifies the two generation requests (creation and
edit) carry the selected provider/model. It does not choose another model when
the expected one is absent. The supplied local-only OpenRouter exception is
enforced as `openai/gpt-5.6-luna` with a maximum explicit cap of 512 output
tokens; use an explicitly authorized Luna key and the exact expected model for
the live run.

For Gateway BYOK runs, the harness prefers `AI_GATEWAY_TEST_KEY` and accepts
`AI_GATEWAY_API_KEY` as a backwards-compatible fallback. It never reads
`AI_GATEWAY_API_KEY_FREE` or `VERCEL_DEPLOY_TOKEN`: the former is the
server-owned free path and the latter is deployment access, not an inference
credential.

Before the first prompt, API-key runs query `/api/config` and require one of
`generationMaxTokens`, `outputCapTokens`, or `maxOutputTokens` to equal
`ORBSIE_OUTPUT_CAP_TOKENS`. If the current server does not expose the matching
cap, the harness records a blocked result and refuses to call the provider.
The harness reports low reasoning and the default service tier as the required
run contract. This is an assertion boundary for the server/provider adapter;
it does not increase a server cap.

The `free` provider mode is separate from Gateway BYOK. It does not read an
API key or select a client model. It checks `/api/trial` in the browser,
requires at least two remaining prompts, and asserts both generation requests
use `provider: "free"` with empty client model and key fields. The server-owned
route is fixed to Gateway Luna with low reasoning and its 4,096-token ceiling;
set `ORBSIE_EXPECTED_MODEL=openai/gpt-5.6-luna` and
`ORBSIE_OUTPUT_CAP_TOKENS=4096` as the explicit run contract.

Set `ORBSIE_REQUIRE_NEW_ONLY=1` when the creation prompt explicitly requests
original geometry. The harness then rejects catalog entities in both the
creation and edit snapshots. When a local Blender builder is connected, it
selects the committed generated entity by stable project order, verifies the
edit request carries that entity ID, and requires its generated model digest to
remain unchanged after the edit.

## Creation, edit, recovery, and playback

The live flow uses a fresh Chromium context and a target-origin traffic guard.
The guard continues approved same-origin requests, allows only the configured
loopback companion when that provider is selected, and aborts other external
origins. It does not fulfill, rewrite, or intercept generation responses.

The browser then:

- submits one bounded creation prompt and observes the real generation request plus a visible
  object reservation/seed in the object list;
- waits for a committed IndexedDB project and `Saved on this device`;
- selects a visible object, submits a scoped recolor, and compares the
  committed snapshots before and after, requiring the same selected ID,
  all other selected properties unchanged, byte-equal unrelated entities, and an unchanged
  environment;
- reloads the tab, resumes the saved draft, and checks title, messages,
  revision, and entity IDs;
- opens Share, downloads the ZIP, and checks `index.html`, `project.json`,
  `runtime.js`, `runtime.css`, pinned `package.json`, `README.md`, build
  instructions, and bundled `src/` files;
- serves that ZIP from a temporary loopback directory in a second signed-out
  context, checks canvas and HUD playback, and fails if the standalone runtime
  requests an editor, provider, or generation endpoint.

The IndexedDB check scans the draft/library values and local/session storage for
the exact SHA-256 digest of the supplied API key or companion capability. Export inspection similarly
rejects provider/session fields and the exact key. Reports contain only model
IDs, status, counts, revisions, sanitized errors, and evidence filenames.

## ChatGPT local companion

The companion mode does not accept an API key. It requires the explicit
loopback values printed by `scripts/run-chatgpt-companion.mjs`:

```sh
ORBSIE_LIVE_E2E=1 \
ORBSIE_TEST_URL=http://127.0.0.1:3001 \
ORBSIE_KEY_SCOPE=local-only \
ORBSIE_EXPECTED_MODEL=gpt-6-astra \
ORBSIE_CHATGPT_COMPANION_URL=http://127.0.0.1:PORT \
ORBSIE_CHATGPT_COMPANION_TOKEN=... \
node scripts/provider-browser-e2e.mjs --provider chatgpt-local
```

The harness navigates to the `#chatgpt=` link only in this explicit mode,
waits for the browser-visible authenticated `GET /health`, and requires the
health response to advertise protocol version 1, the exact expected model, and
low reasoning. The page removes the capability hash before the test continues.
Generation must go to the companion `/generate` endpoint with a bearer
capability and a provider-neutral payload; the browser request must not contain
an API-key, provider, or model field. A missing companion, unavailable local
connection control, health mismatch, or model mismatch is a clear blocked
failure. No ChatGPT credential or capability is placed in evidence.

## Optional real cloud/publication phase

Cloud save and publication are never substituted with the publication polling
fixture. They run only when `--publication` or
`ORBSIE_REAL_PUBLICATION=1` is set and `ORBSIE_CLOUD_TEST_STATE` points to the
existing private synthetic account state. The file must be mode `0600` or
stricter and is read only in that explicit phase. The authenticated browser
context saves the exact live committed revision, then uses the Share UI to
publish and poll to `READY`. A Vercel project/deployment `403`, missing cloud
configuration, revision mismatch, or non-`READY` terminal state is recorded as
`publication.mode = "blocked"`; no fixture response is inserted. A real
`READY` link is opened in a fresh signed-out context and its independent
`project.json` revision and playable canvas are checked.

### Interrupted cloud recovery

Set `ORBSIE_VERIFY_INTERRUPTED_RECOVERY=1` together with
`ORBSIE_VERIFY_CLOUD_RECOVERY=1` to run the opt-in interrupted-stream scenario.
This mode currently accepts only `--provider chatgpt-local` and requires the
mode-0600 `ORBSIE_CLOUD_TEST_STATE` to contain authenticated session cookies.
The interruption method defaults to the editor Stop control; set
`ORBSIE_INTERRUPTION_METHOD=reload` to exercise a page reload while the
authenticated journal is still running. `ORBSIE_INTERRUPTION_METHOD` is
rejected unless interrupted recovery is enabled, and its only values are
`stop` and `reload`.
Invalid combinations are rejected before the browser can send a generation
request. The mode is separate from completed-generation cloud recovery; the
existing `ORBSIE_VERIFY_CLOUD_RECOVERY=1` flow remains unchanged when the
interrupted flag is absent.

After the first real ChatGPT-local generation request starts, the harness observes
successful authenticated `/api/generation-runs` operation acknowledgements until
it sees a running checkpoint with sequence greater than zero and at least one
ready entity. This avoids adding repeated API requests during the short
interruption window. It then uses the configured interruption method. The
default clicks the visible editor `Stop` control while the stream is still in
progress. With `ORBSIE_INTERRUPTION_METHOD=reload`, it reloads the page while
the run remains active, reconnects the local companion through the explicit
connection link, and restores the same project through the authenticated cloud
account UI. If the authoritative local project has the same ID, the harness
may resume it instead. It then uses the account recovery control to settle the
active run; it does not cancel the run through a direct API call. The
checkpoint wait is bounded and condition-driven; a completed run or a missing
live control/recovery state fails with a diagnostic instead of being reported
as interrupted recovery. No generation response is mocked or inserted by the
harness.

The harness opens the account UI, chooses `Recover latest generation`, and
requires a terminal noncomplete journal state (`cancelled` or `interrupted`).
It compares the entire recovered IndexedDB project with the terminal journal
checkpoint (`recoveryCheckpoint` when the server supplies the durable committed
fallback, otherwise `checkpoint`), verifies that the continuation prompt still
contains the original prompt, and verifies the journal-selected entity is
restored when one was recorded. That continuation is submitted through the
editor as the second real generation request; the normal creation assertions
then run on the completed continuation, followed by the existing scoped edit,
reload, ZIP, standalone playback, and cloud recovery checks. The sanitized
report records interruption phases, journal sequence/state, and generation
request counts under `cloudRecovery.interruptedRecovery`, including the
selected interruption method and the pre-reload observer evidence for the
reload variant.

Each run writes a sanitized JSON report to
`docs/evidence/provider-e2e/<provider>.json` and screenshots/ZIP evidence under
`docs/evidence/provider-e2e/<provider>/`. Failure screenshots are retained and
all report paths are mode `0600`. A nonzero exit code means the provider flow
failed or was explicitly blocked; it never means that a fixture passed.

Initial development used syntax checks only. Root integration then ran real managed ChatGPT browser calls with Astra low/default. The current evidence report records the actual completed phases and any remaining failure; a partial report is not a full E2E pass. OpenRouter, Gateway and real publication require their own independent successful reports.

The local OpenRouter Luna exception also passed creation, exact scoped edit, reload, ZIP export and standalone load with the server configured to 512 output tokens. Its first visible reservation was 3.891 seconds. This verifies the authorized Luna path, not the separate Astra requirement. Local test servers must set `BETTER_AUTH_URL` to the exact test origin; production configuration intentionally rejects a mismatched browser origin.

Local Blender runs additionally accept `ORBSIE_BUILDER_URL` and
`ORBSIE_BUILDER_TOKEN` for the foreground modeling companion. The harness
connects through the real Connections UI, requires at least one generated
model, preserves it during the scoped recolor, and scans storage/ZIP text for
the builder capability. `ORBSIE_EVIDENCE_DIR` keeps these reports separate from
other live runs. These options do not change provider/model authorization or
output limits. Never place the private capability in evidence or source.

## ChatGPT-authored input game

`ORBSIE_LIVE_E2E=1 node scripts/verify-chatgpt-authored-game.mjs` starts a temporary authenticated ChatGPT companion and runs the real browser pairing flow against `http://127.0.0.1:3024`. It requires the managed account to expose `gpt-6-astra`; generation uses low reasoning and default processing. The wrapper passes its temporary capability only through the child environment, revokes it on exit, and records the actual generation count in a sanitized `wrapper.json`.

This scenario creates two original procedural/custom objects and three input rules (right adds 7, up wins, left loses), then performs a selected material edit. It checks the unchanged game program through edit, local reload and ZIP export, and plays the downloaded world through score, held-input deduplication, win, restart and loss. It uses no fixture generation transport. `ORBSIE_REQUIRE_INPUT_GAME=1` enables the same scenario in the general harness; default scenarios remain unchanged. This verifies a bounded input game, not Blender construction, cloud recovery or publication.
