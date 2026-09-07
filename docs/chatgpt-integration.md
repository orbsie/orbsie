# ChatGPT subscription integration decision

Checked official documentation and the installed Codex App Server protocol on 2026-09-07.

Orbsie now includes a **trusted local CLI test adapter**, `scripts/local-chatgpt.mjs`, using documented App Server JSON-RPC over child-process stdio. It checks `account/read` for managed ChatGPT authentication and queries all `model/list` pages for an Astra model supporting low reasoning. Every `turn/start` specifies the exact returned model identifier and `effort: "low"`; missing Astra/low fails without fallback. No cached credentials are read, copied, logged, or exported by Orbsie. Codex manages login and refresh.

Run from the repository with dependencies installed:

```sh
codex login status
# If needed, complete the managed login yourself with codex login.
ORBSIE_EVIDENCE_PATH=/tmp/orbsie-live-evidence.json node scripts/run-local-chatgpt.mjs
```

This explicitly invokes two live subscription-backed turns: a three-object scene and an edit to one selected object. The harness validates each streamed JSON command using the application's schema and reducer, requires a concluding revision commit, and checks that the selected edit preserves unrelated entities. Optional evidence contains model ID, effort, commands, and resulting projects, never account details. Temporary bundled code and the empty working directory are removed afterward.

The adapter opens **no HTTP or WebSocket listener**. It runs ephemeral threads with read-only sandbox, network access disabled at turn level, shell tools disabled, web search disabled, and rejects client-side tool/approval requests. Turns have a three-minute deadline and an interrupt path. Run only on the trusted user's workstation. This is not a public subscription relay, a browser connector, or an enabled production “Connect ChatGPT” button. A browser companion would additionally require loopback binding, capability authentication, explicit origin checks, and per-user isolation; none is silently deployed here.

The installed account catalog returned `gpt-6-astra` with low support during the 2026-09-07 verification. This is an observed account-specific identifier, not a hardcoded selection or a promise of availability on other accounts. Live results and remaining verification limitations are recorded in the task report.

Public Vercel generation continues to use the separate OpenRouter and AI Gateway API-key paths. This local test does not validate their billing/authentication paths or establish support for public multitenant use of subscription credentials.

Sources:
- [Codex App Server](https://learn.chatgpt.com/docs/app-server): managed account APIs, model discovery, stdio protocol, turns and interrupts.
- [Codex authentication](https://learn.chatgpt.com/docs/auth): credential lifecycle and trusted-environment restrictions.
