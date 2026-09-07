# ChatGPT subscription integration decision

Checked official documentation on 2026-09-07.

Codex App Server documents managed account login through `account/login/start`, including ChatGPT browser/device-code flows, account status and logout. It describes an integration protocol, but does not establish that a public, multitenant Vercel application may relay arbitrary users' subscription credentials as a general model API.

Codex authentication documentation specifically says not to expose Codex execution in public or untrusted environments. Subscription sign-in and ordinary API keys have different credential lifecycles and billing.

**Decision:** no enabled ChatGPT connection in this build. No subscription cookies, cached tokens, local Codex credentials or undocumented endpoints are used. The `generateCommands` boundary accepts provider-specific transports; a future ChatGPT adapter requires a demonstrated supported architecture. A trusted local companion with per-user isolation is a candidate, not a verified or hidden dependency.

The current implementation contains OpenRouter and AI Gateway API-key relay paths. Neither has been live-tested with user credentials in this session. Model catalogs are queried and model IDs are not silently substituted. Astra availability is not established, so no Astra ID is hardcoded.

Sources:
- https://learn.chatgpt.com/docs/app-server
- https://learn.chatgpt.com/docs/auth
- https://vercel.com/docs/ai-gateway/sdks-and-apis/openai-chat-completions
- https://openrouter.ai/docs/api_reference/streaming
