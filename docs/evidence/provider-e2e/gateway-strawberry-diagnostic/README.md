# Gateway strawberry diagnostic

This bounded diagnostic targeted source `042c486` at
`http://127.0.0.1:3018` with the exact creation prompt `a tree with blue
strawberries`, model `openai/gpt-5.6-luna`, low reasoning, default service
tier, and a 4096 output-token cap. The intended flow allowed one create request
and one edit request only if creation succeeded.

The corrected run made exactly one Gateway generation request. It returned
HTTP 200 and emitted a browser-visible seed at 5948ms, then the app rejected
operation 4 as `INVALID_SCENE_JSON` with sanitized diagnostic
`{"operation":4,"issues":[],"finishReason":null}`. No revision was saved and
the edit request was correctly not attempted. No fallback or retry occurred.

The original production observation was a server-owned free request with
`browserModeling: true`, `localModeling: false`, an empty model, and project
revision 0. Its response body was not retained. The Gateway BYOK run confirms
the same broad invalid-scene symptom under a different provider path, but the
empty issue list and null finish reason do not identify whether the provider
stream, JSON boundary, or command parser caused operation 4 to fail.

The earlier empty-key preflight is preserved in
`credential-preflight-blocked.json`. The local production server was stopped
and the corrected private env file was deleted. The current sanitized result
is in `gateway.json`; screenshots are `connection-model.png`,
`intermediate-seed.png`, and `failure.png`.
