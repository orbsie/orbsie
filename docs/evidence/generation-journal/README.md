# Durable generation journal API evidence

`report.json` records an actual run against the local app at `http://127.0.0.1:3017` and its configured development PostgreSQL database. No model inference or production requests were made.

The harness authenticated the existing synthetic development owner, saved isolated synthetic worlds, and exercised operation persistence, exact retry, conflicting retry, sequence gaps, terminal commit, latest-checkpoint discovery, ordered replay, anonymous/second-owner denial, concurrent append/cancel, cloud revision drift and same-revision snapshot drift. The latest report records 17 passing assertions across 34 requests.

Run with `node scripts/verify-generation-journal.mjs` after the local app and generation migration are ready. Authentication fixtures live only in `.vercel` with mode 0600; they are not evidence artifacts. Each rerun creates three small synthetic worlds/runs and consumes the account's bounded journal quota. The harness stops on rate limiting and permits only local port 3017.

`browser.json` and `recovered-browser.png` separately prove signed-in completed-checkpoint recovery into the browser's local draft, with no inference requests or page errors. These artifacts do not prove provider streaming, lease expiry over elapsed time, or continued generation after recovery.

Retention now makes room at the 64-run account limit by pruning only the oldest superseded terminal/expired runs needed for admission. The newest checkpoint for each world and all active runs remain protected; 64 protected entries can still fill the quota. Deleted historical run IDs return 404. The live API/browser artifacts above predate the retention change.

The opt-in `tests/generation-retention-database.test.ts` subsequently passed against the real development PostgreSQL database with source `a91d552`. It seeds 64 synthetic runs, concurrently admits two new runs, verifies only the two oldest histories disappear, checks cascading operation removal and preservation of another owner's record, then verifies 64 active runs reject admission without deletion. All synthetic users/worlds/runs are removed in `finally`. The single test passed in 3.46 seconds, without inference or production requests. Reproduce only against a development database:

```sh
RUN_GENERATION_RETENTION_DATABASE_TEST=1 node --env-file=.env.local node_modules/vitest/vitest.mjs run tests/generation-retention-database.test.ts
```
