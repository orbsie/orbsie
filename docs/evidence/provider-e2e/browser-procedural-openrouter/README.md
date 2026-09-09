# Live procedural OpenRouter attempt: not accepted

The production build from `b289e7f` was served locally on port 3049. The
authorized model was `openai/gpt-5.6-luna`, low reasoning, default processing,
with a 512-output-token cap. The requested creation was one new pedestal
whose dimensions were computed by a compact QuickJS expression. No fallback
or intercepted provider response was used.

Two setup failures occurred before inference: the initial server had the
default output cap, then its production origin setting rejected the local
browser request. Their reports are retained separately. The server was
restarted with `ORBSIE_GENERATION_MAX_TOKENS=512` and
`BETTER_AUTH_URL=http://127.0.0.1:3049`; the origin check remained enabled.

The subsequent generation returned HTTP 200 but the provider stream emitted
an error before any reservation. The UI reported an interrupted generation;
the harness failed after its 180-second reservation deadline. There was one
generation request in this final run, no edit request, and no model fallback.
The previous diagnostic omitted upstream status, so this evidence does not
establish the cause of the provider error. Bounded numeric stream-status
diagnostics were added afterward; no automatic retry was made against the
unchanged diagnostic path.

Creation, editing, export and publication remain unverified for live
procedural authoring. The successful editor fixture is separate evidence.
