# Hosted ChatGPT live acceptance contract

The product connection is browser-only. The existing local-companion harness
and its historical reports do not prove the hosted subscription workflow.
This document specifies the hosted harness addition; implementation and real
acceptance must be recorded separately.

The test reuses an explicitly authorized Orbsie session and an already
user-consented hosted ChatGPT runtime. It must not create a login, perform
consent, log out, cancel the user's runtime, copy a browser profile, or read
ChatGPT cookies. A missing or expired account/runtime stops before inference
and produces a blocked result. Orbsie login alone does not prove ChatGPT consent.

Inputs are an HTTPS Orbsie target, explicit live-test opt-in, exact model
`gpt-5.6-luna`, and a private Orbsie storage-state file supplied expressly for
this test. Validate configuration before reading the file. Require permissions
0600 or stricter and admit only cookies scoped to the exact target host; reject
foreign-domain credentials and omit local-storage data. Never include session
contents in console output, reports, screenshots or exported projects.

The real status endpoint must report connected. The real model catalog must
contain the exact Luna model with low reasoning support. Select that model in
the visible connection UI. Hosted requests use `/api/chatgpt/generate`, with
model, low effort, project, prompt, selected entity and browser modeling fields;
they carry no API key, provider credential or companion capability. Any fallback
to `/api/generate`, another model, or a loopback companion fails acceptance.

Enforce these boundaries before network dispatch, not only by inspecting
completed requests. The hosted traffic guard blocks generation until the
session, consent and model checks pass; rejects invalid generation payloads;
and blocks a third generation request. It also blocks account start, cancel
and logout mutations and provider fallback routes. Record any rejected attempt
as an acceptance failure. A successful HTTP response containing a stream error
is not successful inference.

Run exactly two authorized generation requests: creation and a selected-object
edit. Preserve existing visible reservation, scoped-state, reload, secret-scan,
ZIP export and independent-player assertions. Hosted interruption recovery and
publication require separate explicit milestones; do not reuse the archived
companion helpers for them. Close only the test browser context afterward.

Reports distinguish:

- blocked before inference (no session, consent, capability or exact model);
- existing consent reused (not a newly observed login);
- live inference observed and full create/edit/export assertions passed;
- synthetic harness tests, which never establish live consent or generation.

The OpenRouter local-only authorization remains separate and unchanged:
`openai/gpt-5.6-luna`, explicit output cap no greater than 512 tokens. Hosted
ChatGPT uses its own bounded server generation policy; adding the harness does
not increase that policy or authorize model substitution. End-user model
selection remains unrestricted among the product's supported models.

## Running the hosted milestone

The hosted mode is implemented and reviewed. Ten focused synthetic tests
pass, including CLI blocked-report creation, request boundaries, stream
completion and canonical project-schema rejection before dispatch. The schema
is bundled from the application protocol after private account-state checks;
the temporary bundle is removed after import. Syntax checks also pass. These checks do not prove real
subscription consent or inference. The command below is the live invocation,
not a record of successful subscription acceptance.

After the owner supplies an expressly authorized, private cookies-only
Orbsie storage-state file and completes ChatGPT consent in the product:

```sh
ORBSIE_LIVE_E2E=1 \
ORBSIE_TEST_URL=https://orbsie.com \
ORBSIE_EXPECTED_MODEL=gpt-5.6-luna \
ORBSIE_SERVICE_TIER=default \
ORBSIE_ACCOUNT_STORAGE_STATE=/absolute/private/orbsie-state.json \
node scripts/provider-browser-e2e.mjs --provider chatgpt-hosted
```

The path is a placeholder, not an existing credential. Do not commit the state
file or copy ChatGPT cookies into it. This invocation does not need an API key,
local companion, or installation on the user's computer. The acceptance driver
runs in the development environment against the browser-only product.

An unavailable session, disconnected runtime, or missing Luna capability must
produce an actual sanitized blocked report without dispatching generation.
The report must distinguish that outcome from an attempted generation failure.
The milestone covers create/edit/reload/export; separately record publication,
signed-out playback and newly observed account consent before claiming the
complete provider journey.
