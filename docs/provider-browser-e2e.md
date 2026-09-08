# Provider browser E2E harness

`scripts/provider-browser-e2e.mjs` is the opt-in acceptance harness for a real
browser session. It is separate from `scripts/verify-provider-ui.mjs` and the
other fixture checks: it never installs a route that fulfills `/api/generate`,
never imports the fixture transport, and never treats a snapshot as provider
evidence.

The harness fails closed before Chromium starts unless the caller explicitly
sets `ORBSIE_LIVE_E2E=1`, chooses `--provider openrouter`, `--provider gateway`,
or `--provider chatgpt-local`, supplies an exact `ORBSIE_EXPECTED_MODEL`, and
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
tokens; use a separately authorized key and an explicit expected model for an
Astra-low run.

Before the first prompt, API-key runs query `/api/config` and require one of
`generationMaxTokens`, `outputCapTokens`, or `maxOutputTokens` to equal
`ORBSIE_OUTPUT_CAP_TOKENS`. If the current server does not expose the matching
cap, the harness records a blocked result and refuses to call the provider.
The harness reports low reasoning and the default service tier as the required
run contract. This is an assertion boundary for the server/provider adapter;
it does not increase a server cap.

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

Each run writes a sanitized JSON report to
`docs/evidence/provider-e2e/<provider>.json` and screenshots/ZIP evidence under
`docs/evidence/provider-e2e/<provider>/`. Failure screenshots are retained and
all report paths are mode `0600`. A nonzero exit code means the provider flow
failed or was explicitly blocked; it never means that a fixture passed.

Initial development used syntax checks only. Root integration then ran real managed ChatGPT browser calls with Astra low/default. The current evidence report records the actual completed phases and any remaining failure; a partial report is not a full E2E pass. OpenRouter, Gateway and real publication require their own independent successful reports.

The local OpenRouter Luna exception also passed creation, exact scoped edit, reload, ZIP export and standalone load with the server configured to 512 output tokens. Its first visible reservation was 3.891 seconds. This verifies the authorized Luna path, not the separate Astra requirement. Local test servers must set `BETTER_AUTH_URL` to the exact test origin; production configuration intentionally rejects a mismatched browser origin.
