# Public API authoring review handoff

This is the next bounded implementation task after the review-ledger cancellation
fence. Read `docs/authoring-review-integration-task.md` for the full three-phase
contract. This task owns the server-only admission coordinator, the public API
review route for free/OpenRouter/Gateway, and focused route/PG tests. It does not
own hosted private review, browser orchestration, deployment, or live calls.

## Authority boundary

- Accept a dedicated POST with an opaque initial run ID, `review` or
  `final-review`, original prompt/selected entity, current project, original
  provider/model/effort/modeling flags, an optional revision-bound image, and
  bounded structural feedback. Apply origin and body-size checks before work.
- Move identity and fingerprint derivation from the initial-admission module to
  shared server-only functions. Initial and review must use identical prompt
  normalization, selected ID, provider/model/effort, and modeling flags. The
  browser never supplies a trusted identity, digest, phase token, capability,
  or review-slot count. A signed trial cookie identifies free use; linked API
  uses the same visitor/session rule as initial admission without an email gate.
- Re-resolve the catalog model and configured output format. Bind the exact model
  ID and effort stored by the initial phase. For free, use `FREE_MODEL` and the
  configured free Gateway key; do not call `claimTrial` again or reserve more
  global units. Reject a supplied image before ledger admission if the current
  catalog does not affirm image input. Omitted image is structural-only review.
- Compute `createSceneBinding(project)` server-side. Atomically admit the phase
  only if the ledger has this identity/fingerprint and the exact completed
  revision/digest. A replay, mismatched scene, provider switch, selected-ID
  switch, or old cookie/session must make zero model calls. Carry the request
  abort/deadline signal through admission, executor and completion.
- Call `executeSceneReview` once per admitted phase with the resolved format and
  capabilities. Complete the phase with the executor's validated resulting
  binding. First accept terminates after two total model calls. First revise
  may return a correction batch plus the server-owned commit and leaves one
  final verdict-only slot; final defects produce an honest partial result.
  No retry or fourth call is allowed. On any failure/cancel, await independent
  bounded exact-token cleanup; consume late provider promises.
- Return only typed verdict, issue summary, canonical validated corrections,
  resulting revision/digest, evidence scope, and remaining calls. Do not return
  phase tokens, credentials, raw model output, private completion records, or
  the server's copy of the whole project. Include a distinct request ID and
  correlate with the existing client run ID in allowlisted diagnostics.

## Acceptance evidence

Use actual route invocations with mocked provider/catalog transport and real
PostgreSQL for the critical authority cases. Prove free accounting, exact
identity/fingerprint, wrong scene, replay, first accept, first revise followed
by final partial, unsupported image before admission, provider failure,
cancel during inference, and cancel during held COMMIT acknowledgement. Assert
model-call counts and ledger phase/slot state. Run focused tests, TypeScript,
format/diff checks. Read the installed Next 16 route-handler guide before
editing route code. Preserve tests' synthetic credentials and never print a
real key.
