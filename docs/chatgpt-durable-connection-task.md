# Durable ChatGPT connection contract

User authorizes preserving Orbsie ChatGPT login across browser/app sessions and
reports mid-session stream loss. Timer mismatch is separate bounded fix. Do not
claim durable persistence from a longer host timeout or local model preference.

## Architecture decision for review

Retain short-lived nonpersistent isolated sandbox execution. Durable connection
state must outlive that sandbox and be encrypted server-side, isolated by the
existing authenticated owner. Use a dedicated credential-vault record with purpose-
separated authenticated encryption, owner/connection version AAD, bounded retention,
and revocation epoch. Do not reuse generic host capability encryption unchanged.
Only app-owned managed authentication produced by Orbsie's own device login may
enter this path. Never read developer CODEX_HOME, browser cookies or OS account.

Use documented managed auth cache in the isolated runtime, with fixed app-owned
paths, bounded size and strict no-symlink/file checks. Explicitly configure file
credential storage there. Treat cache as opaque sensitive bytes, not API key. The
OpenAI managed runtime must continue handling refresh; save updated cache after
login and token refresh, not only the original snapshot. Source checked:
https://learn.chatgpt.com/docs/auth#credential-storage and login-caching.

A narrow authenticated private host export/import operation may transport this
cache only between trusted server components. It must never be passed through a
browser route, model request/result, diagnostic, project, screenshot or export.
Import only before starting the isolated provider process; no arbitrary path/URL.
No default global Sandbox resume:true and no infinite running host.

## Lifecycle and concurrency

A new valid owner session may restore its remembered connection after browser
restart; anonymous owners rely on their secure persistent app cookie. Do not invent
an identity from localStorage or imply restoration after cookies are deleted.
New runtime provisioning restores the owner's unexpired vault record, then verifies
managed account status before exposing ready. Model preference is separate and
nonsecret. Generation must never start solely from that remembered preference.

Serialize active use/refresh for one durable connection to avoid token-rotation
races between multiple sandboxes. Fence saves by connection version/host attempt:
late old-host completion cannot overwrite newer credentials or resurrect logout.
Capture refresh state at a reliable lifecycle boundary before success is reported;
address midstream token refresh and abrupt host shutdown explicitly. If safe refresh
persistence is not established, report the gap rather than claiming acceptance.

Disconnect first revokes/deletes durable authority atomically, then cancels/destroys
active runtimes. Teardown failure never restores authority. Explicit logout/account
change clears remembered preference. Decide session logout versus provider disconnect
consistently with existing auth hooks; no credential restoration after revocation.
Authentication expiry/rejection requires reconnection; transient transport/catalog
failure preserves preference and does not silently create an anonymous replacement
or erase saved credentials. No hidden inference retry.

## UI and policy

Remembered connection must be a clear user choice (owner has explicitly requested
it), with encrypted server storage and Disconnect removal. A checkbox controlling
only local model selection must not imply that it controls credential retention.
Keep provider-only login email-free. Restore asynchronously with cancellation and
account/provider version guards. Do not overwrite a newer manual provider choice.

## Acceptance

First failing reproduction, then meaningful tests: fresh isolated runtime restores
same owner after old runtime destruction; rotated managed cache survives next
restart; foreign owner cannot restore/decrypt; tampering/expiry rejected; concurrent
refresh fenced; disconnect racing save cannot resurrect; transient failure and stale
UI callback do not clear/overwrite valid connection. Additive schema migration,
rollback and real PostgreSQL contention evidence. Test browser reload using secure
app session plus separately persisted preference. No live model calls required for
these fixtures; actual signed-in hosted restart/generation remains release gate.

Deliver in bounded cohesive stages with root review of each finished diff. Do not
introduce partial server persistence under a UI success claim.

## Current handoff 1: vault foundations only

Implement additive private tables and purpose-separated AES-GCM/HKDF storage for
at most64KiB opaque app-owned cache, thirty-day expiry, and exclusive refresh
leases with connection/version/epoch fencing. No public endpoint or UI claim yet.
Metadata reads must not decrypt; only successful exclusive lease returns cache.
Verify active owner/session for every operation, protect against concurrent logout,
and recheck a fresh database clock after lock waits. Session expiry also constrains
lease headroom. Expired remembered records may be retired atomically when a new
authorized connection is remembered. Disconnect deletes ciphertext and preserves
the revoked connection fence. Validate byte length before allocating a cache copy.

Real DB test must route the actual storage functions to an independent PostgreSQL
pool, not merely create SQL tables while those functions still use a mocked
client. Verify persisted rows, single lease winner, rollback, expiry after a lock
wait, session deletion, and stale save after revoke/reconnect. Root prepared an
isolated loopback/tmpfs database for this handoff; never use production credentials.

After root accepts primitives, implement the app-owned runtime cache bridge and
private host transport, then route/session restoration integration. Preserve the
complete restart-to-generation acceptance target across these bounded handoffs.

### Runtime integration finding for the next handoff

Root source review: createIsolatedChatGPTRpc.close terminates the provider process
and removes the entire owned directory. Generation safetyCleanup invokes that
close on interrupted/unconfirmed turns. Therefore saving credentials only after a
successful generation misses rotated auth on failure/cancel. The runtime bridge
must take a bounded app-owned cache snapshot before directory removal and expose
it only to trusted private-host persistence handling; no weakening of process
termination to keep credentials alive. Finalization must attempt fenced snapshot
save for success, failure and cancellation with a separate bounded cleanup budget,
then release the lease. Preserve no-resurrection after Disconnect. Report abrupt
host/platform termination limits honestly; never claim a stale original token
snapshot is sufficient. Test simulated cache rotation followed by forced RPC close
and reconstruction of a fresh runtime from the saved updated cache.

## Integration source audit (2026-09-13, after vault acceptance)

Current public status/models actions call manager.read only; absent host returns
Disconnected even if durable authority will exist. Generation acquire likewise
returns null without reconstruction. Restore must be an explicit authenticated
manager operation shared by these paths, with verified account/read before Ready.
Do not implement restoration only in the Start button.

Current generation route returns response.body directly. A durable-use lifecycle
must instead own stream finalization: on normal EOF, error, reader cancellation
and request abort, attempt updated private cache capture/save under an independent
bounded cleanup signal, then release authority. Never expose cache in NDJSON.
Capture must remain possible after generation safetyCleanup closes the RPC.
Do not count a partial stream as a committed scene, or silently replay inference.

Current logout sends remote logout before manager.disconnect. Durable revocation
must precede remote calls so a failed/slow provider logout cannot leave credentials
restorable. Login cancel is different from Disconnect: cancelling a pending new
challenge must not accidentally revoke a previously remembered account. Preserve
this distinction in route tests and UI wording.

The sandbox health probe currently requires disconnected+idle after provisioning.
Do not weaken it to accept arbitrary preauthenticated hosts. Keep provisioning
empty and use a separate authenticated private initialization/restore operation,
which imports before starting the managed process that will use the cache. The
private host HTTP adapter currently rejects every non-generation request body;
adding a restore operation requires explicit method/path/body bounds in both the
HTTP adapter and handler, not only a backend client method.

### Required ownership rule before enabling public restoration

A vault lease is an exclusive right to run a refresh-capable managed process, not
just to write the resulting ciphertext. Releasing a lease while that process can
still make account/read, model/list or generation calls allows two hosts to rotate
the same credential. The next orchestration stage must retain authority for the
entire process lifetime, or terminate/snapshot that process before releasing it.
Choose and implement one complete lifecycle; do not merely wrap database saves.
If leases can expire while a host remains reachable, enforce a private-host
execution deadline and reject old-epoch admission, with shutdown before another
lease can be admitted. Database save fencing alone does not prevent provider-side
refresh races. Exercise two sessions plus a delayed old host in integration tests.

Private host transport must not add cache actions to the public [action] allowlist.
Test that public response projection strips any unexpected sensitive host fields.
The existing sandbox outbound allowlist contains only provider domains, so a host
callback to an Orbsie persistence endpoint is not currently available. Do not rely
on such a callback without explicitly implementing and validating its authorization,
network policy and bounded shutdown behavior. Prefer trusted server orchestration
for the first complete lifecycle.

### Chosen first orchestration: operation-scoped managed processes

Reuse the private sandbox HTTP service, but instantiate a fresh isolated managed
process for each authenticated status/models/generation operation. Acquire the
owner's vault lease, initialize that process from its cache through the private
host capability, perform the operation, then seal (terminate and snapshot), save
under the exact lease/version/epoch and release. This avoids holding a refresh
lease throughout idle browser sessions and preserves short-lived execution. It
adds process startup overhead; measure it at the hosted acceptance milestone.
Do not reprovision/install a new sandbox for every model call.

A private controller serializes its process slot and binds it to an unpredictable
operation ID plus lease epoch/deadline. Calls cannot address an earlier process
by sending only the general sandbox capability. Initialization is single-use;
concurrent initialization returns Busy. After sealing, repeated finalize for the
same operation may retrieve its bounded snapshot for safe persistence retry, but
must not restart the process or model call. Keep at most one retained snapshot,
expire it and clear it on explicit Disconnect. No inference retry is introduced.

Set a process deadline strictly before the lease deadline (include clock-skew and
shutdown allowance). Expired operations reject new RPC admission and terminate.
Server-side orchestration must not release early if termination is unconfirmed;
in that case destroy the sandbox or retain the lease until its fenced expiry.
A fresh owner session may later recover from the last successfully persisted cache;
a provider rejection then requires truthful reconnection, not false Ready.

New device login is a separate pending operation with no imported remembered cache.
On verified login completion, seal its process and persist the newly produced cache
before reporting the durable connection as saved. Existing active remembered
connections require explicit account replacement semantics rather than overwriting
vault rows during Start. Cancel only terminates this pending operation.

Generation finalization must have reserved route headroom: the present public route
and managed generation both allow 180 seconds, leaving no guaranteed cleanup time.
Allocate a bounded portion of the existing route deadline to sealing/persistence,
and propagate the shorter generation deadline instead of extending billable calls.
Test normal completion, cancellation and deadline exhaustion with rotated caches;
prove no process continues after release and no secrets enter public responses.
