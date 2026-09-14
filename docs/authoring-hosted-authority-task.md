# Hosted scene completion authority (next handoff)

After initial API ledger integration is accepted, carry the same authority through
actual managed ChatGPT HTTP transport. Root selected a versioned private completion
record rather than replaying a second full scene interpreter in the web process.
This is private protocol metadata, not a model command or public request token.
Root shared interface: src/lib/server/chatgpt-scene-completion.ts, with13 focused
contract checks. It validates bounded version/binding metadata only; it does not
authenticate, negotiate, parse the whole stream, strip records or grant authority.
Use it in the transport integration rather than introducing a competing schema.

Source path verified on1c740bd: api/chatgpt/generate -> durable.generate -> manager
privateOperation -> sandbox-backend POST /private/operation/generate -> host.ts
handler -> managed-operation.generate -> createChatGPTSceneStream. Private generate
body strictly allows operationId,epoch,input; preserve that legacy body. Existing
executors may survive web deployments and do not automatically gain capabilities.

Negotiate completion-record version1 via an explicit private request/response
header, forwarded by backend/manager typed options. When requested, require matching
response capability before issuing a model call if possible; at minimum reject an
old host response without accepting scene authority or retrying inference. Prefer
a separate private capability preflight within the existing bounded managed
operation before generate. Do not treat an ignored request header as negotiation.
Normal one-call legacy requests remain compatible. Unsupported executor must not
silently pretend review is available or fall back to legacy session generation.

On negotiated managed generate only, use the accepted adapter lifecycle callback
to append exactly one bounded private completion record with version, operationId,
epoch, projectId, revision, binding version and canonical digest after clean provider
termination. No source/mesh/prompt/key/phase token needed. Do not write the record
from finally or from an observed commit line. Abort/hook error/trailing provider
failure cannot emit success. Private host authentication and operation binding
remain required; a client-supplied body or header cannot mint authority.

Consume and strip this record inside durable service, before the stream reaches
public diagnostics or browser. Enforce one record, exact version/operation/epoch/
project, safe revision and digest, no scene commands after it, bounded line parser,
no duplicate/unknown metadata accepted. Wait for clean private stream termination
before invoking the web ledger completion hook. A valid record is scene authority,
not evidence that credential seal succeeded. Credential finalization still needs
its independent bounded cleanup allowance; preserve last good scene when sealing
fails and explicitly report credential cleanup separately. No callback functions
or durable ledger phase tokens cross HTTP.

Wire opted-in initial hosted route to the same ledger coordinator and secure
owner/session identity. Keep operation credential lease held through seal/cache
save/clear. Test real public route -> durable service -> manager/private HTTP
handler -> managed controller with mocked RPC, including success, missing/duplicate
record, bad digest/binding, old-host negotiation, provider failure after commit,
Disconnect/cancel, DB completion failure and seal failure after valid scene output.
Assert no private completion record/tokens escape to browser and no new call/retry.
No live acceptance claim until owner signed-in browser workflow can be tested.
