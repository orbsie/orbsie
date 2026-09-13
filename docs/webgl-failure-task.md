# WebGL failure correction contract

Evidence: docs/evidence/owner-browser-texture-check/orbsie-fallback.json.
Production owner Chrome cannot initialize WebGL; UI hides error and enables Create.

Own src/components/world.tsx, orbsie.tsx, relevant styling and focused tests.
World's existing onReady belongs to Player gameplay readiness and cannot gate
landing creation. Add a separate onRendererReady callback from Canvas.onCreated.
Orbsie tracks initializing/ready/unavailable; users may type and connect providers
while initializing, but generation requires ready. Store availability in a ref
as well as rendered state to reject submission races. Check before allowance
lookup and again after awaited preflight, before clearing prompt or starting a
provider request. The common submit handler must protect retries and keyboard
submission as well as the disabled Create/Change button.

On real World failure, show a persistent accessible graphics message on landing
and workspace, preserve the typed draft, and stop active generation if necessary.
Do not clear the message as a transient toast or replace it with unrelated notice.
Keep provider connections, saved worlds and export accessible. No demo world or
silent software-rendering fallback. Do not automate browser settings or bypass
blocked browser diagnostics. A saved-world claim must match actual persistence.

Verify forced creation failure yields visible feedback, disabled creation, zero
generation requests, retained draft and working Connections. A normal renderer
must reach ready on landing and permit generation (request interception only;
no model calls). Cover failure during asynchronous allowance preflight and
ordinary keyboard submission. Preserve existing Player readiness semantics.
Then verify the real owner Chrome error path before production deployment.
