# Durable generation journal API evidence

`report.json` records an actual run against the local app at `http://127.0.0.1:3017` and its configured development PostgreSQL database. No model inference or production requests were made.

The harness authenticated the existing synthetic development owner, saved isolated synthetic worlds, and exercised operation persistence, exact retry, conflicting retry, sequence gaps, terminal commit, latest-checkpoint discovery, ordered replay, anonymous/second-owner denial, concurrent append/cancel, and cloud revision drift. All 15 assertions passed across 28 requests.

Run with `node scripts/verify-generation-journal.mjs` after the local app and generation migration are ready. Authentication fixtures live only in `.vercel` with mode 0600; they are not evidence artifacts. Each rerun creates three small synthetic worlds/runs and consumes the account's bounded journal quota. The harness stops on rate limiting and permits only local port 3017.

This evidence proves API/database behavior. It does not demonstrate browser recovery interaction, provider streaming, lease expiry over elapsed time, or continued generation after recovery. The parent task verifies browser recovery separately.
