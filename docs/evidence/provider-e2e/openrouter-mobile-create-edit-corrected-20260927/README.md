# Mobile OpenRouter create/edit/export journey

One fresh run against `http://127.0.0.1:3054` used application source commit
`e51434b`, model `openai/gpt-6-luna`, low reasoning, default service tier, and
a 4,096-token output cap. The `/api/generate` origin preflight passed with
HTTP 400. The run made exactly two model requests; both returned HTTP 200 and
no fallback was used.

Creation, material edit, export, and standalone playback passed. The report
records 7 creation operations, a preserved selected entity, zero blocked
external requests, and no page errors. In 390×844 Chromium emulation at DPR 2
with `isMobile` and `hasTouch` enabled, it recorded no horizontal overflow and
reachable connection, prompt, edit prompt, and all five standalone control
bounds. A real emulated Right touch moved the player 0.64 units. The default
scene has no authored game rules; no score or win result was asserted.

`openrouter/standalone-playback.png` was captured in the same mobile standalone context,
after the touch check and a two-second settle. It visibly shows the WASD
footer but no touch buttons. The report records their browser-visible bounds
and the observed touch movement; the screenshot does not visually prove the
buttons. This run used browser emulation, not a physical phone. The report and
five screenshots were checked for the local API key; the exported project
contained no credential markers. The raw `world.zip` was omitted from the
committed evidence.
