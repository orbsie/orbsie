# Generation failure recovery evidence

This deterministic browser run exercises the real editor UI with a fixture
transport. It covers a failed edit with no original selection, explicit retry
after selecting another object, ordinary toast dismissal, last-working restore
after a later valid increment, and retry of a selected edit after changing the
visible selection. The run recorded seven intercepted `/api/generate` fixture
submissions, with no automatic extra request, provider call, account, cloud,
or database mutation.

Commands used from the repository root:

```sh
npx vitest run tests/generation-recovery.test.ts
npm run typecheck
npm run build
npm run start -- --port 3022
node scripts/verify-generation-failure-recovery.mjs docs/evidence/generation-failure-recovery
```

The browser command was run against the local production build at
`http://127.0.0.1:3022`. The fixture supplied `/api/config`, session, models,
projects, trial, and generation responses; all other same-origin assets used
the local server and external HTTP requests were blocked. Geometry used the
existing procedural tree and rock schemas, so no browser modeling worker,
provider, deployment, or live network path was exercised.

`report.json` contains sanitized request summaries and assertions. The
`recovery-actions.png` screenshot shows the two recovery actions in the error
toast. No credentials, cookies, or private response bodies are recorded.
