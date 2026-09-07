# Cloud acceptance

Run: 2026-09-07T23:37:43.185Z
Target: https://orbsie.com

- Owned-site robots check: HTTP 404; bounded API acceptance run, two publications maximum.
- Accounts and publishing configuration enabled.
- Two synthetic Better Auth accounts authenticated; secrets stored only in ignored mode-0600 state.
- Saved flagship project 802ed9c1-c54d-4f35-8db2-7b4948b2780c, revision 64; GCS archive completed (archivePending=false).
- Authenticated list and reopen preserve flagship entities.
- Second user cannot read or overwrite the first user’s project (404).
- Stale cloud compare-and-swap rejected (409).
- FAIL: Publish: 502 {"error":"Vercel could not complete publication (403). Your previous release is safe."}

502 !== 200


Infrastructure diagnosis: the dedicated token can read the main Vercel project (HTTP 200), but creating a deterministic Orb project returns HTTP 403 with action `create`, resource `project`. Database and storage checks above completed successfully. No public deployment was created.
