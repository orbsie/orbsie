# Priority: working AI account and subscription connections

The owner's latest clarification makes usable ChatGPT subscription and AI account/API connections the highest priority. This supersedes the earlier backlog deferral. Do not extend modeling features while the essential connection flow is unresolved.

Current implementation: the local companion starts Codex App Server over stdio, reads the managed account, requires ChatGPT authentication and selects an explicitly available model. Startup performs no inference. Its private origin-bound connection link pairs the browser with a loopback server. Settings no longer directs users to CLI setup (de30678). The owner clarified that a pasted-link/CLI flow is insufficient; do not implement it as the primary connection experience.

Official documentation checked September 8, 2026: https://learn.chatgpt.com/docs/app-server documents `account/login/start` with type `chatgpt`, a returned browser `authUrl`, and `account/login/completed`; it also documents managed device-code login. These are App Server integration methods. They do not establish an ordinary hosted Vercel OAuth client for consuming a ChatGPT subscription. The local runtime is experimental evidence only and does not satisfy the browser-only product requirement. Do not request copied cookies or subscription tokens as API keys.

Acceptance must show: understandable browser-only connection choice; supported authorization and verified account/model readiness; useful failures without secrets; disconnect/revocation; refresh/reconnect behavior; and an actual generation using the selected subscription model. Keep OpenRouter and Gateway key verification paths available. Local companion experiments and mocked tests alone are not evidence that the product connector is live.

Live tests remain Luna-only with regular processing. End users can choose supported models. Do not alter an existing Codex login or initiate a different account login without a concrete need; inspect account readiness first without exposing credentials.

## OAuth simplicity requirement

The required experience is Connect → authorize/sign in → return connected, without terminal commands or pasted links. OpenRouter explicitly documents browser OAuth PKCE at https://openrouter.ai/docs/guides/overview/auth/oauth. Implement S256 PKCE with a short-lived, state-bound transaction, fixed exchange endpoint, one-time callback consumption and no credential leakage into project storage or logs. Preserve current explicit credential-persistence choices.

ChatGPT subscription browser sign-in is documented through Codex App Server, but a hosted third-party subscription OAuth integration has not been established by the inspected documentation. The owner explicitly rejected installation: the entire user connection workflow must run in the browser. Local companions, desktop helpers and pasted private links do not satisfy this requirement. Do not silently substitute OpenRouter billing for the requested ChatGPT subscription, and do not count local account readiness alone as product connection acceptance.

Browser-only is a firm requirement. A supported hosted subscription integration remains unverified; retain that requirement as unresolved rather than replacing it with the existing companion experiment.

## Current evidence and immediate gaps

- OpenRouter PKCE and Settings callback shipped in 1ec0591 and are deployed. Ten core tests and a simulated browser redirect/callback passed; real OAuth consent remains unverified because regular Chrome is unavailable to computer use.
- Live Luna OpenRouter model creation, material edit, reload and standalone export passed (7ec1bad). This used the existing API key, not an OAuth-issued credential.
- OAuth blocked-storage, cancellation and pending-control fixes are reviewed and deployed, along with unsent composer prompt preservation (57218cd). Simulated production success and cancellation passed; existing-world selection recovery is undergoing targeted acceptance. These checks do not prove real provider consent.
- Gateway funded live acceptance and browser-only ChatGPT subscription authorization remain unresolved. No local-install workaround satisfies the owner constraint.
