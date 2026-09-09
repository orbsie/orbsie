# Priority: working AI account and subscription connections

The owner's latest clarification makes usable ChatGPT subscription and AI account/API connections the highest priority. This supersedes the earlier backlog deferral. Do not extend modeling features while the essential connection flow is unresolved.

Current implementation: the local companion starts Codex App Server over stdio, reads the managed account, requires ChatGPT authentication and selects an explicitly available model. Startup performs no inference. Its private origin-bound connection link pairs the browser with a loopback server. Settings currently describes the CLI command but lacks the direct ChatGPT link field already available for Blender. A settings connection flow is the immediate implementation task.

Official documentation checked September 8, 2026: https://learn.chatgpt.com/docs/app-server documents `account/login/start` with type `chatgpt`, a returned browser `authUrl`, and `account/login/completed`; it also documents managed device-code login. These are App Server integration methods. They do not establish an ordinary hosted Vercel OAuth client for consuming a ChatGPT subscription. Keep subscription authentication in the supported local runtime and do not request copied cookies or subscription tokens as API keys.

Acceptance must show: understandable connection choice; explicit local prerequisite; successful pairing and verified account/model readiness; useful failures without secrets; disconnect/revocation; refresh/reconnect behavior; and an actual generation using the selected subscription model. Keep OpenRouter and Gateway key verification paths available. Local companion experiments and mocked tests alone are not evidence that the product connector is live.

Live tests remain Luna-only with regular processing. End users can choose supported models. Do not alter an existing Codex login or initiate a different account login without a concrete need; inspect account readiness first without exposing credentials.
