# Cloud snapshot conflict verification

The report records a real local authenticated API/database run on port 3017 using the existing development account and a newly created test world. Local database configuration was confirmed distinct from production. The test performed no generation or browser UI work and emitted no credentials.

The same revision number with different saved content produces a different snapshot token. A stale token and a missing token both return 409 without modifying the intervening save. A write using the current token succeeds. Run `node scripts/verify-cloud-snapshot-cas.mjs` against the configured local development server to reproduce.
