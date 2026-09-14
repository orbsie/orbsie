# Initial API authoring-run integration

Prerequisites: ledger5cedb2e and scene binding/lifecycle1c740bd accepted internally.
Implement this one handoff before hosted private authority, review execution and
browser orchestration. No claim of a working review loop from initial admission.

Own src/app/api/generate/route.ts, a small server authoring orchestration helper,
necessary additive changes to authoring-run-ledger.ts/trial.ts, and targeted tests.
Read installed Next route-handler guide before editing the route. Preserve other
work. No agents, live model calls, deployment, production migrations or UI edits.

Add optional authoringReview:true initial request admission gated by server
ORBSIE_AUTHORING_REVIEW=1. Disabled or missing request opt-in preserves existing
one-call behavior, trial charge and responses; no public review endpoint yet.
An enabled request must issue the ledger before inference and return only opaque
X-Orbsie-Authoring-Run-Id. It is an identifier, not a review authorization or proof
of completion. Phase tokens, identity hashes and fingerprints remain private.
Fail explicitly when opt-in is requested but unavailable; do not silently charge
three calls or advertise review when configuration/migration is absent.

Use current signed HttpOnly visitor identity for anonymous requests. If a secure
Better Auth session exists, bind linked API runs to owner+session with a separate
HMAC domain; do not create an email login prerequisite. Free issuance must still
use trialIdentity and its existing quota identity. No client-selected identity,
raw key/prompt persistence or API key in request fingerprint. Bind normalized
original prompt, selected entity, admitted provider/model and authoring flags in
a domain-separated HMAC fingerprint. Initial scene is independently bound with
createSceneBinding. Reuse the ledger's exact admitted model/effort types.

Free opt-in: issueAuthoringRun performs one atomic trial charge+issuance, charging
one visitor/network prompt and reserving three global units; do not also claimTrial.
Linked API: no free charge. Separate cookie presentation from free-error masking:
setting a visitor cookie for linked API must not turn its auth error into a free
provider failure. Preserve legacy model-preflight/output-format behavior.

Wire generateCommands lifecycle into actual ledger completion/failure. Use the
validated final binding from callback; never trust client completion/revision or
emitted commit alone. Catch setup/provider failures after issuance as well. Await
completion before clean EOF, use bounded independent failure cleanup, scrub hook
errors. No retries/refunds/new calls. Keep original provider stream framing.

Cancellation needs actual transaction semantics: an aborted completion waiting on
a row lock must not later authorize review. Carry a signal through lock acquisition
and precommit checks; bound DB lock/statement waits and cleanup. A check before
calling the ledger is insufficient. Explicitly handle cancellation arriving during
COMMIT acknowledgment: retain enough private phase authority to fail this same
initial completion before any review admission, while preventing a delayed failure
from terminating a newer review phase. Propose the exact narrow transition if the
existing completed-state token clearing must change; do not weaken replay/phase
checks. No client can invoke that cleanup authority.

Targeted evidence using real route and production generation parser with mocked
provider transport: legacy path unchanged; enabled free charge once/three units;
linked no email/free charge; invalid input/preflight does not issue/call; successful
stream writes authoritative completion; commit then error/trailing command/EOF
fails; consumer/request cancel; writer rejection safely fails; no sensitive token
or prompt/key in response/logs. Existing targeted route tests must still pass.
Add actual PostgreSQL race tests for delayed completion/abort and phase-token
fencing; root will provision a synthetic local DB and run those. Do not repeat
unrelated full E2E. Report changed files, checks/results, assumptions and risks.
