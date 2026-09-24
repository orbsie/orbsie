# Hosted ChatGPT test output-bound audit

Read-only audit on 2026-09-24; no model call or account mutation ran.

The private host pins `@openai/codex` 0.153.4 in
`scripts/build-chatgpt-host.mjs`. The installed system CLI is 0.156.1. Both
versions' `codex app-server generate-ts` outputs define `v2/TurnStartParams`
without `maxOutputTokens`, `max_output_tokens`, or another per-turn output-token
ceiling. Their generated file SHA-256 values are, respectively:

```
0.153.4 049f50eff62666ed07e171d8d0a8ec08e745f697d71972a4a169e4fb7b3682d2
0.156.1 aee116ebc86d05a738ae7cdace79f791a8b99a85693c3a005c295eb7e08b647c
```

The [official App Server turn-start documentation](https://learn.chatgpt.com/docs/app-server#turns)
lists model, effort, service tier, sandbox, and output schema overrides, but no
per-turn token ceiling. The [configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference)
also does not list a model-output ceiling; `tool_output_token_limit` concerns
stored tool output, not generated model output.

`src/lib/server/chatgpt-generation.ts` already bounds delivered output to
512 KiB, 8,192 deltas and 180 seconds. These are application transport bounds;
they cannot guarantee 4,096 generated output tokens or a provider billing cap.
The product's owner-approved historical hosted harness describes a maximum of
two calls under those bounds in `docs/hosted-chatgpt-acceptance.md`, while a
later owner instruction requires a 4,096-token ceiling. A fresh owner choice
is pending; until then, do not label hosted inference as satisfying the hard
token-cap requirement.
