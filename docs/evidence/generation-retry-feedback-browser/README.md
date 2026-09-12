# Browser retry feedback evidence

This deterministic Playwright run exercised the real editor recovery UI against
the local production build from source `c01a1fe`. The browser intercepted every
`/api/generate` request and returned fixture NDJSON. External HTTP requests were
aborted, unexpected same-origin API requests were aborted, and no provider,
account, cloud, database, or paid inference call was possible.

The fixture returned a bounded `INVALID_SCENE_UPDATE` diagnostic after valid
partial work. Both visible **Try again** actions forwarded the expected
project-scoped feedback (`invalid_type` at
`geometry.job.recipe.nodes[2]`, reason `unreachable_recipe_node`). Ordinary
new prompts after dismissal and after **Use last working** sent no feedback.
The final report records seven intercepted generation submissions, zero live
inference calls, no automatic extra request, no blocked external requests, and
no page errors.

Commands from the repository root:

```sh
npm run build
npm run start -- --port 3022
node scripts/verify-generation-failure-recovery.mjs \
  docs/evidence/generation-retry-feedback-browser
```

Artifacts:

- `report.json` — sanitized request summaries and assertions from the passing run.
- `recovery-actions.png` — the visible recovery action state.
- `failed-selected-reservation-fixture.json` and `failure.png` — preserved first
  probe, where a selected new-only fixture incorrectly attempted a pending
  reservation before the structured error. The final fixture removes that
  unrelated policy violation.

The build also regenerated `public/player/runtime.js` and
`public/player/source.json`; those outputs remain available for review.
