# Live republishing acceptance — failed at first release page

- **Run:** 2026-09-12T00:40:35Z–2026-09-12T00:40:45Z
- **Service:** `https://orbsie.com`
- **Authorization:** one fresh synthetic `example.com` account for the requested
  publication acceptance; no terms were accepted and no email was sent.
- **Account:** `orbsie-publication-republish-20260912t004050@example.com`
- **Fixture:** `pub-accept-mtxnsco2` (the harness-generated ID for this run)
- **Mode:** `ORBSIE_LIVE_E2E=1`, `ORBSIE_PUBLICATION_REPUBLISH=1`
- **Deployment submissions:** 1 (revision 1); revision 2 was not submitted.
- **Retry behavior:** no retry and no account rotation.

The run created the account, saved revision 1, submitted its first publish, and
reached the first signed-out release check. The release page response was in the
successful HTTP range but did not contain `data-ready="true"`, so the harness
stopped with `first public release page is not data-ready`. The report does not
contain deployment or project IDs because it only records those fields after the
complete first-release assertion succeeds. No password, cookie, token, or page
contents were written here.

`report.json` is the sanitized harness output. The deployed output was left in
place as requested for review; no cleanup or deletion was attempted.
# Read-only first-release recovery

After the harness stopped, an exact-ID read-only database query recovered the
test Orb's deployment mapping. A fresh signed-out Chromium context then loaded
the deployment, observed `main[data-ready="true"]` and its canvas, and fetched
the revision-1 project snapshot. No page errors or cookies were present.
See `recovered-first-release.json` and `recovered-first-release.png`.
This confirms client-rendered readiness; revision 2 remains unsubmitted.
