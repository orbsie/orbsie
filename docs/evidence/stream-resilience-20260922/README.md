# Generation stream recovery evidence

The browser fixture replaces only `/api/generate` with deterministic browser
`ReadableStream` responses. It makes no provider calls or server database
mutations. The run exercised initial-generation and edit rollback, explicit retry,
body read rejection, invalid commit, and UTF-8 decoding with a byte split inside
`café`.

The report records eight intercepted requests and no automatic retry. The
desktop screenshots use 1280×900; the Android-size screenshots use 390×844.

Validation run for this evidence:

- `npx vitest run tests/generation.test.ts tests/chatgpt-scene-stream.test.ts tests/scene-binding-adapters.test.ts tests/generation-observability.test.ts tests/generation-diagnostics-client.test.ts tests/generation-observability-replay.test.ts tests/authoring-activity-store.test.ts tests/generation-recovery.test.ts`
- `npm run typecheck`
- `node scripts/replay-generation-diagnostics.mjs`
- `node scripts/verify-generation-failure-recovery.mjs docs/evidence/stream-resilience-20260922`

See `report.json` and the desktop/Android recovery screenshots in this folder.
