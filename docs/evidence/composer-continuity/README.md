# Composer continuity evidence

Status: **passed**

The verifier ran one actual-editor keyboard path against `http://localhost:3030` with normal motion (`prefers-reduced-motion: no-preference`). It filled the real `#prompt`, pressed Enter through the editor's direct key handler, held one deterministic fixture `/api/generate` response, and waited for the normal descent caption to settle (`Click an object to make it your own.`). While held, the textarea stayed attached and active, the canvas identity stayed unchanged, and no blur/focusout or native form submit event occurred. It then typed ` Keep the follow-up idea ready for later.` without clicking or refocusing; after releasing the fixture response, that draft remained and the exact original prompt appeared once as the user message.

Evidence:

- App source: `f6e58014983878c6136babfe86c8aaa782bcb4c0`
- Repository checkout: `4c70a132566847a097937dd68b924f698b4e9409`
- Generation requests: 1 app request and 1 fixture-server request
- Normal descent samples: 73; settled samples: 129; overflow: false; continuity violations: none
- Page errors, console errors, and blocked external requests: none
- Google Fonts CSS was fulfilled locally
- Screenshot/report: `docs/evidence/composer-continuity/final.png` and `docs/evidence/composer-continuity/report.json`

Chromium reports `net::ERR_ABORTED` for the rewritten localhost fixture request after the committed response was consumed. This matches the existing deterministic fixture harness behavior; the response returned 200 and the generated scene completed. It is recorded in the JSON evidence and is not a provider error.

Scope remains one deterministic held-response run. It does not establish partial-stream gameplay behavior, live-provider behavior, or a broader performance claim.

Astra reviewed the final harness and screenshot, narrowed tolerated request failures to the single rewritten fixture POST with `net::ERR_ABORTED`, and reran the focused browser check successfully. The check uses an explicit app source revision; omitted attribution is labeled unverified.

Reproduce against a production build of the stated app source:

```sh
TEST_URL=http://localhost:3030 ORBSIE_APP_SOURCE_COMMIT=f6e58014983878c6136babfe86c8aaa782bcb4c0 node scripts/verify-composer-continuity.mjs
```
