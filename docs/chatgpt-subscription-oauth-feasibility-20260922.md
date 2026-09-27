# Direct ChatGPT subscription authorization feasibility

Checked against current official OpenAI documentation on 2026-09-22. This is
an implementation gate for `prompt.md`'s requested browser-only flow:
**Connect with ChatGPT → approve on OpenAI → return to Orbsie, connected**, with
no one-time code.

Rechecked the same official App Server, authentication, and plugin OAuth pages
on 2026-09-23. The documented App Server browser callback remains localhost;
the documented device flow remains a URL plus user code. No Orbsie-style HTTPS
subscription OAuth client registration or inference grant was established.

Rechecked the current official pages on 2026-09-24. The App Server browser
example still returns a `localhost` callback even with its hosted success page,
and the device flow still requires a code. The experimental external-token
interface still assumes a host that already owns the ChatGPT authorization
lifecycle. The newer [workload identity federation guide](https://developers.openai.com/api/docs/guides/workload-identity-federation)
is for trusted Codex automation in a managed ChatGPT workspace, requires
workspace enablement, and does not register a browser OAuth client for an
Orbsie user's personal subscription. The missing HTTPS callback and
subscription inference grant remain an external feasibility gate.

Rechecked the [official Codex App Server authentication documentation](https://learn.chatgpt.com/docs/app-server#3-log-in-with-chatgpt-browser-flow)
on 2026-09-27. The documented browser flow still returns a `localhost`
callback hosted by App Server, and the documented device flow still requires a
verification URL and user code. In the owner's restored Chrome session, being
signed in to ChatGPT did not itself connect Orbsie: Orbsie's device challenge
remained pending and later expired without a completed authorization. This is
live UI evidence of the interim flow's extra step, not proof that the requested
direct HTTPS callback is supported.

## What is documented

- The Codex App Server `account/login/start` browser flow returns an `authUrl`
  whose `redirect_uri` points to `http://localhost:<port>/auth/callback`.
  The App Server hosts that callback. `useHostedLoginSuccessPage` changes the
  success page, not the callback URI or OAuth client registration.
  Source: https://learn.chatgpt.com/docs/app-server#3-log-in-with-chatgpt-browser-flow
- The documented headless fallback is a device-code flow requiring the user to
  open a link and enter a code. This is the interim Orbsie flow, not the
  owner's requested direct-return experience.
  Source: https://learn.chatgpt.com/docs/auth#login-on-headless-devices
- `chatgptAuthTokens` is an experimental App Server mode for a host that
  already owns the ChatGPT authorization lifecycle and can supply/refresh its
  own tokens. It is a runtime token interface, not an authorization grant or
  a documented way to register Orbsie's HTTPS callback.
  Source: https://learn.chatgpt.com/docs/app-server#3c-log-in-with-externally-managed-chatgpt-tokens-chatgptauthtokens
- ChatGPT plugin OAuth documents the reverse role: ChatGPT is the client for
  a third-party service's authorization server, and callbacks terminate at
  `chatgpt.com`. It does not authorize Orbsie as a ChatGPT subscription client.
  Source: https://developers.openai.com/plugins/build/auth

## Decision and missing proof

The public documentation above does not establish an OpenAI-issued client ID
for Orbsie, registration of an `https://orbsie.com` callback, subscription
inference entitlement for that client, or refresh/revocation terms. This is
an absence-of-proof finding, not a claim that OpenAI can never support it.
Do not repurpose the App Server localhost callback, copy browser cookies, or
present plugin OAuth as the requested solution. Keep the deployed device-code
path explicitly interim and preserve OpenRouter/Gateway account or API paths.

To close the requirement, obtain official OpenAI documentation or provider
confirmation for the client, HTTPS callback and subscription inference grant;
then demonstrate a registered callback and server-side token exchange in a
test deployment before implementing the full return-to-Orbsie lifecycle.
Identity-only OpenAI login would not prove subscription-backed generation.
