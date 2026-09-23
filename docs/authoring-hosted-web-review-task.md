# Hosted review web orchestration handoff

This task follows the accepted private `/private/operation/review` transport.
It owns `chatgpt-durable-service.ts`, an authenticated
`/api/chatgpt/review` POST route, the initial hosted route's capability response
header, and focused durable/route tests. It does not edit the private host
implementation or browser store. Read
`docs/authoring-hosted-review-task.md` and the installed Next route-handler
guide before editing a route.

Authenticate the owner/session through the existing BetterAuth guest-capable
path; an Orbsie email/password is not a prerequisite. Validate the same original
prompt, selected ID, model, effort, modeling flags, scene, optional image and
bounded structural observations as the API route. Reuse the shared server-only
identity/fingerprint and scene-binding coordinator. Never accept client digest,
phase token, capability or slot count as authority.

The durable service must acquire the current credential lease and managed host,
negotiate `x-orbsie-scene-review: 1` on status, and reject an old host before
ledger admission or inference. Then the route admits the exact ledger review
phase, and the durable service sends one typed private review request bound to
the current operation ID/epoch. Check the private response version, header,
content type, size, operation identity and phase. On the web side, replay the
host's canonical corrections against the admitted project with existing
policy/scene/provenance checks and recompute its binding; a private JSON object
or claimed digest alone cannot complete a review.

Complete the ledger phase with that verified binding while the managed lease is
still held. Seal/save/clear and release with the existing independent cleanup
headroom before returning success. If sealing fails after a valid review,
surface credential-finalization failure distinctly and invoke the retained
exact-token ledger failure fence; never emit an accepted review to the browser.
Provider failure, Disconnect, client abort, stale host reply or late COMMIT
acknowledgement must fail the admitted phase and cannot authorize a later slot.
No hidden retry, fourth call, raw model text, credential cache or phase token.

Return the same public typed review result shape as the API route, with a
distinct request ID, original client run ID, and allowlisted phase/call index/
scope/outcome diagnostics. Tests should run the real durable controller against
the real private HTTP handler with mocked RPC and synthetic vault/database,
covering preflight rejection, accept, correction, final partial, wrong epoch,
Disconnect, abort, late reply, seal failure and replay. Assert provider-call
counts, ledger state, sanitized response and lease cleanup; run focused tests,
TypeScript, format/diff checks. No live account or credential output.

For the browser's first capture decision, expose the hosted model's admitted
image-input capability on the initial generation response as
`X-Orbsie-Review-Image-Supported: 1|0`, matching the API initial route. Derive
it from the server-side ChatGPT model catalog used by that managed operation;
unknown is `0`. Do not trust a client flag or advertise vision based on a
remembered model label. Ensure the private review call enforces the same actual
catalog capability before inference.
