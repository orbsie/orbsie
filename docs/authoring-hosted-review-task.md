# Hosted ChatGPT authoring review handoff

This task follows the accepted public review coordinator. Read
`docs/authoring-review-integration-task.md`. It owns the authenticated hosted
review route and the managed private HTTP review operation, including focused
mock-RPC tests. It does not own browser orchestration, deployment, or live calls.

The web route must authenticate the current owner and session before deriving
the same authoring identity/fingerprint as initial generation. It must use the
shared review admission coordinator and never treat a browser-supplied token,
digest, capability, or completion record as authority. An anonymous guest
BetterAuth session is sufficient; an Orbsie email/password is not required.

Extend the actual managed host contract with versioned review capability
negotiation on `/private/operation/status` (a distinct
`x-orbsie-scene-review: 1` contract), then a typed
`/private/operation/review` bound to the exact operation ID and epoch. A host
without the capability must be rejected before ledger admission or inference.
The review request
may include a bounded image, so the private body cap must cover the validated
review payload without relaxing unrelated control-route limits. The host runs
`executeSceneReview` through its managed `createChatGPTGeneration` runtime and
returns only a versioned result with its operation ID/epoch, parsed verdict,
canonical corrections and resulting binding. The web side checks that private
identity, replays/validates the corrections against its admitted snapshot and
recomputes the binding before completing the ledger phase. A private JSON
object alone is not scene-completion authority.

Keep the existing credential lease, operation deadline, seal/save/clear and
independent cleanup headroom. A Disconnect, stale epoch, cancel, late reply or
old host cannot complete the review. Credential seal failure after a valid
model verdict is a distinct failure from model/scene validation, and must not
silently authorize another call. Preserve the exact chosen model and effort,
regular service tier, bounded output, and zero automatic retry.

Tests must drive the real private HTTP handler and durable controller with
mocked model RPC. Cover capability rejection before inference, valid accept,
targeted revision, stale binding, Disconnect, abort, late reply, seal failure,
private response bounds and token-free public output. Run focused tests,
TypeScript, format/diff checks. Never use a live ChatGPT account in focused
development tests or print credentials.
