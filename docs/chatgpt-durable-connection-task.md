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
