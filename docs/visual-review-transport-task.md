# Bounded image transport prerequisite

Queued after capability propagation; one Luna worker, root review. This implements
internal transport support, not public review endpoints or the complete loop.
Do not expose a new free inference path before server-owned allowances exist.

## Sources and existing interfaces

Root inspected generation.ts messages[].content (currently JSON text),
chatgpt-generation.ts GenerateInput/turn-start (one text item), and
chatgpt-generation-policy.ts (exactly one text input allowed). Hosted
chatgpt-scene-stream.ts passes assembled text/instructions to generate().

Primary documentation checked 2026-09-13:
- https://openrouter.ai/docs/guides/overview/multimodal/image-understanding:
  chat completions accepts multipart content and base64 image data; text first.
- https://vercel.com/docs/ai-gateway/openai-compat/rest-api.md:
  official REST example uses text followed by image_url.url with a PNG data URL.
- https://learn.chatgpt.com/docs/app-server#turns and pinned0.153.4 schema:
  image input uses type:image/url. Actual hosted data-URL ingestion remains an
  acceptance gate; schema recognition is not successful inference.

## Ownership and contract

Small shared pure review-image validation/type module; internal generation.ts
content assembly, chatgpt-generation.ts typed input and process-policy guard;
focused transport/policy tests. Add scene-stream plumbing only as an internal
trusted option if needed. Keep public schemas/routes unchanged in this task.
No UI/model loop, database changes, arbitrary remote fetches, or live model calls.
Preserve existing model/effort/service tier/caps/abort/output validation behavior.

Represent one capture with projectId, nonnegative safe-integer revision, renderer,
width, height, and PNG data URL. Bind identity/revision to the current project in
callers that possess it; do not trust a client renderedRevision claim as authorization.
Reject arbitrary URLs/local paths, non-PNG data, bad base64/signature/IHDR/dimensions,
extra image entries, mismatched declared dimensions and over-limit payloads.
Use encoded128KiB and pixel cap no larger than capture's existing cap; validate
before allocating buffers. Server validation must be independent of client refs.
Do not use page screenshots, upload images publicly, or record image bytes in logs.

API content: preserve the exact existing string when no image is present; with
image use text item then image_url item. Hosted content: text then image/url item.
The process guard should accept only these two intended shapes; preserve exact
sandbox policy, known thread/model/effort, service tier and input-key restrictions.
Bound aggregate UTF-8 encoded text+image JSON against existing hosted256KiB input
budget and existing route512KiB ceiling; don't increase caps to make tests pass.
Omit optional fields when absent so existing text-only consumers remain compatible.

Capability checks belong at the trusted model selection boundary: hosted catalog
must explicitly advertise image; API loop caller must use server model-preflight
capability. False/unknown yields a typed unsupported-image outcome, never automatic
model substitution. Do not imply that unsupported models cannot generate text.
The loop task will turn this into honest limited-review UI and authorization.

## Acceptance

Mock outgoing HTTP/RPC and assert exact bounded image payload alongside unchanged
text-only wire output. Cover stale identity/dimension mismatch, malformed/oversized
input, unknown/false capability, cancellation and rejected overrides; no payload
leaks in diagnostics. Preserve current text-only generation and sandbox tests.
Report focused checks and remaining actual-runtime ingestion gate. Root will use
one bounded Luna image milestone only after transport plus loop integration is ready.
