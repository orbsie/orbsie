# Local ChatGPT companion

The foreground companion connects the Orbsie browser to a managed local Codex App Server over stdio. It runs on your computer. The hosted Orbsie service does not receive ChatGPT credentials or relay subscription requests.

Install Codex and sign in locally with `codex login`, then run from the repository:

```sh
npm install
node scripts/run-chatgpt-companion.mjs
```

Startup discovers an available Astra model supporting low reasoning; it fails without a fallback. Startup does not run inference. Open the private link printed in the terminal and keep that terminal open while creating. Stop it with Ctrl+C to revoke the connection. The process installs no daemon.

The link contains an ephemeral random 256-bit companion capability, **not a ChatGPT credential**. Treat the link as private. The browser consumes its fragment once, removes it from the address bar, and retains the capability only in memory. Reconnect after a reload or companion restart. Browser permission to reach the local network may be required; support depends on browser policy.

The default allowed website is exactly `https://orbsie.com`. For local development, explicitly configure one origin:

```sh
ORBSIE_ORIGIN=http://localhost:3000 node scripts/run-chatgpt-companion.mjs
```

No trailing slash, path, wildcard, or origin list is accepted. A custom HTTPS deployment origin is also supported. HTTP is accepted only for explicit loopback origins.

## Boundary and protocol

The HTTP listener binds `127.0.0.1` on an ephemeral port. Every request must have the exact configured Origin and exact `Host: 127.0.0.1:<port>`. GET and POST require `Authorization: Bearer <capability>`. The only unauthenticated operation is a constrained CORS preflight from the allowed origin; it allows GET/POST and Authorization/Content-Type, including private-network opt-in. The server does not redirect.

- `GET /health` returns only `{protocolVersion:1, model, effort:"low", status:"ready"|"busy"}`.
- `POST /generate` accepts `{prompt, project, selected?}` as JSON. The prompt is bounded to 5,000 characters, the request to 1 MiB, and project data uses the existing project schema. Selected IDs must exist. Extra top-level properties are rejected.
- Success uses `application/x-ndjson`, with the same command records consumed by the existing editor. Complete records are schema checked and applied to a private working project using `applyOperation` before streaming. Partial JSON is buffered, bounded to 100,000 characters; total output is bounded to 2 MiB and 250 commands.
- The final commit is held until generation finishes successfully. Intermediate commits are released before the next validated command, preserving completed checkpoints. Missing final commits, invalid commands, and provider interruptions produce a generic `{error:...}` record. Completed scene updates can be preserved by the editor's normal recovery flow.
- One generation runs at a time; overlap returns 429. Disconnect and a 180-second deadline abort generation. Shutdown closes the listener and managed transport and removes temporary directories.

The CLI builds its backend bundle into a temporary directory and starts App Server from a separate empty temporary working directory. The adapter requests ephemeral threads, standard processing, low effort, read-only sandboxing, no network, and no shell/web tools. It rejects App Server approval/tool requests. Account checks stay in the adapter; account metadata and provider errors are never serialized to HTTP clients. Credentials remain managed by Codex: the companion does not read credential files or export OAuth tokens.

The local capability restricts access to the authorized website and launch. It is not protection against a compromised local OS or code already executing in that authorized website.

## Evidence and references

`npx vitest run tests/chatgpt-companion.test.ts` exercises only injected mocks and loopback HTTP; it does not call a model. Actual managed-account/browser inference is separate verification and was not performed for this change.

The implementation follows the official [App Server documentation](https://learn.chatgpt.com/docs/app-server) for stdio transport, managed ChatGPT authentication, model discovery, ephemeral threads and low-effort turns. The [authentication documentation](https://learn.chatgpt.com/docs/auth) describes locally managed sign-in. These documents establish the local integration mechanics, not a public hosted subscription relay or universal account availability.

Root integration subsequently passed the real browser create → scoped edit → reload → ZIP export → standalone-load workflow using managed `gpt-6-astra`, low effort and default processing. See `docs/evidence/provider-e2e/chatgpt-local.json`: two generation requests, first visible reservation at 8.132 seconds, no fallback, no intercepted generation. `standalone-settled.png` separately verifies the exported scene after its initial camera transition, with zero page errors. This is local companion evidence, not production hosting, gameplay completion, or independent cloud publication evidence.
