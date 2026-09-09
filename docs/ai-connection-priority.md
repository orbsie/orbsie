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
- OAuth blocked-storage, cancellation and pending-control fixes are reviewed and deployed, along with unsent composer prompt preservation (57218cd). Simulated production success and cancellation passed; existing-world selection recovery passed on production aaa0d0d: success and cancellation preserve both entities, revision 9, selected object and prompt, and clear pending OAuth drafts without persisting the provider key. These checks do not prove real provider consent.
- Gateway funded live acceptance and browser-only ChatGPT subscription authorization remain unresolved. No local-install workaround satisfies the owner constraint.

Browser-only Settings cleanup (aaa0d0d) is deployed at https://orbsie.com (immutable deployment https://orbsie-69tp8a1yy-grappeggias-projects.vercel.app). `TEST_URL=https://orbsie.com node scripts/verify-openrouter-oauth-draft.mjs` passed both simulated outcomes and verified that the local Blender connection-link field is absent. Production build and TypeScript passed. This uses synthetic account responses and performs no live model calls.

Provider failure recovery is deployed in `35676c8` at https://orbsie-bf6lky3we-grappeggias-projects.vercel.app (https://orbsie.com). `TEST_URL=https://orbsie.com node scripts/verify-provider-reconnect.mjs` passed all four synthetic 401/403 scenarios for OpenRouter and Gateway: prompt restoration, connection settings reopened, rejected keys cleared only for 401, no live model calls. This is failure-path acceptance rather than live authorization acceptance.

## Hosted device authorization feasibility checkpoint — September 8, 2026

Rechecked [App Server authentication](https://learn.chatgpt.com/docs/app-server) and [headless authentication](https://learn.chatgpt.com/docs/auth). App Server exposes `chatgptDeviceCode`, returning a verification URL, user code and login ID, then completion/account notifications. Device login is beta and may need enabling in personal security settings or workspace permissions. The hosted success-page option for ordinary browser login does not remove its localhost callback.

Inference: an isolated hosted App Server could avoid a user-installed companion using device authorization. This is a candidate to investigate, not a verified public subscription connector. Device-code entry also differs from a pure redirect-only OAuth experience. The inspected sources do not establish Orbsie's multi-user hosting authorization or a ready-made Vercel deployment arrangement.

Next implementation gate: establish a supported host and per-user credential/process isolation, bounded lifecycle and cost, session-bound start/status/cancel/logout transport, refresh and revocation handling, and no user-controlled shell/tool execution. The current `LocalChatGPT` harness inherits the developer process environment and login; it cannot be reused as a shared production account. Do not copy the developer credential cache into hosting. No new login, inference, paid infrastructure or account mutation was performed for this checkpoint. Modeling and rendering remain browser-local regardless of where inference runs.

Installed-runtime evidence: `node scripts/inspect-chatgpt-auth-contract.mjs` passed on codex-cli 0.153.4; see `docs/evidence/chatgpt-auth-contract/report.json`. It generates schemas in a temporary directory and removes them, without starting App Server, logging in or performing inference. Device authorization request/response fields are present. Unlike the broader experimental wording on the documentation page, this installed schema explicitly labels `chatgptAuthTokens` internal-only; exclude direct external-token injection from Orbsie's implementation. Schema support alone does not validate hosted authentication, account permissions, refresh or generation.
