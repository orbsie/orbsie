> **Archived historical experiment.** The local companion material below is retained for provenance only. Current Orbsie product delivery is browser-only and does not accept companion links or require local installation.

# ChatGPT subscription integration decision

Historical documentation review: 2026-09-08. Implementation status updated 2026-09-09.

Current product decision: ChatGPT subscription connection must work entirely in the browser, without installation, a local companion or pasted connection links. The browser-only connector is deployed; production device-challenge issuance and cancellation passed. Actual subscription consent, model discovery after consent, and hosted generation remain unverified. [The current connection plan](ai-connection-priority.md) tracks hosted device authorization, runtime isolation and the remaining acceptance gates. Geometry and rendering execute locally in the browser regardless of inference hosting.

Local change `267b975` adds cleanup before Orbsie session deletion, including sign-out and revocation. It reads cleanup metadata for ready, expired, and provisioning hosts without decrypting their capability, destroys the runtime, and then releases its claim. Cleanup failure does not prevent app-session revocation; the independently enforced ten-minute runtime lifetime remains the fallback. Eighteen targeted tests and TypeScript checks passed. This cleanup change is deployed with source `cfa9901`; production smoke passes, while a real hosted-session sign-out remains unverified.

The following records the historical local experiment, not the supported product connection. It used managed Codex App Server over child-process stdio on the user's computer. The hosted Orbsie server did not receive subscription credentials or relay those requests. This experiment does not satisfy the latest browser-only requirement.

The official [App Server documentation](https://learn.chatgpt.com/docs/app-server) describes managed account inspection through `account/read`, available-model discovery through `model/list`, and streamed turns. The [authentication documentation](https://learn.chatgpt.com/docs/auth) distinguishes ChatGPT subscription sign-in from separately billed API-key access and documents local `codex login`. These interfaces support the chosen local integration; they do not establish account-specific Astra availability or authorize a public subscription relay.

## Historical companion experiment

From a checkout with dependencies installed and Codex available:

```sh
codex login status
# Complete codex login locally if needed.
node scripts/run-chatgpt-companion.mjs
```

Open the private link printed by the foreground process. The default website origin is `https://orbsie.com`; local development can set an exact origin, for example `ORBSIE_ORIGIN=http://localhost:3031`. Stop the process with Ctrl+C to revoke the connection. See [companion setup and protocol](chatgpt-companion.md) for browser local-network permissions and connection details.

`scripts/local-chatgpt.mjs` checks for a managed ChatGPT account and queries every model catalog page. It defaults to an available Astra model with low reasoning support. `ORBSIE_CHATGPT_MODEL` selects another exact catalog model with low support, including Luna for live tests; an unavailable or incompatible selection fails without substitution. Thread and turn requests explicitly select default processing; turns use low effort. Orbsie neither reads credential files nor copies OAuth tokens. The adapter requests ephemeral threads, a read-only sandbox, disabled network and shell/web tools, and rejects tool or approval requests from App Server.

`scripts/chatgpt-companion.ts` binds an ephemeral `127.0.0.1` port and checks the exact configured Origin and listener Host. Authenticated requests require a fresh random capability. The browser consumes the private link fragment, removes it from the URL, and keeps that capability in memory; reload requires reconnection. This capability is distinct from ChatGPT authentication. The server permits one generation at a time, validates bounded scene commands before streaming them, and aborts on disconnect or deadline. The editor uses its normal reducer, persistence, scoped editing, and export paths. These boundaries assume a trusted local OS and authorized website.

The original `scripts/run-local-chatgpt.mjs` remains an opt-in CLI integration check. It makes live model calls and is separate from mock-based unit tests.

## Verified scope and remaining conditions

- [Initial live browser report](evidence/provider-e2e/chatgpt-local.json): managed `gpt-6-astra`, low reasoning, default processing; creation, selected-object material edit, local reload, ZIP export and standalone loading. Two generation requests, no fallback. This records a past run rather than current account availability.
- [Live reload-recovery report](evidence/provider-e2e/chatgpt-reload-recovery/chatgpt-local.json): interruption by document reload, recovery of a durable checkpoint, explicit continuation, scoped edit, export and input-rule gameplay. Fresh-context cloud recovery requires no new generation. This is checkpoint continuation, not resumption of the original provider stream.
- [Scope audit](scope-audit.md): remaining full-plan acceptance gates. Current live development tests use Luna only; native Blender delivery is superseded. Historical local ChatGPT evidence does not prove browser-only subscription access or the complete provider/publication matrix.

That experiment requires a compatible managed account, available model access, a running local companion, and a browser that permits the loopback connection. Those requirements exclude it from the browser-only product workflow. The replacement hosted implementation is deployed with per-session isolated runtimes; full subscription acceptance remains pending. OpenRouter offers a PKCE connection flow as well as API-key access; real OAuth consent remains unverified. Gateway uses its own credentials and requires separate live validation.
