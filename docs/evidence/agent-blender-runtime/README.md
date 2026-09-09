# Agent Blender runtime evidence

The new `scripts/run-blender-job.mjs` command ran a typed one-part box job through the existing isolated executor with installed Blender 4.0.2. The retained GLB is 1,896 bytes. Astra independently checked its GLB magic, declared byte length and SHA-256 against `metadata.json`, reviewed the CLI, and required bounded file-handle reads and a final cancellation check before acceptance.

Four targeted CLI tests passed: help without runtime startup, oversized input rejection, preservation of an existing destination, and cleanup after invalid typed input. Syntax and diff checks passed. The runtime run made no model calls or downloads. It proves local agent access to real Blender, not a portable runtime distribution or clean-host release.

The runtime input was a typed box job; exact bounds, material and mesh statistics are retained in `metadata.json`. See [usage](../../agent-blender-runtime.md). The GLB and metadata contain no host paths or credentials.
