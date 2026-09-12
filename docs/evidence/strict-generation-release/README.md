# Strict-generation production smoke

Read-only release validation for deployment `BKUuZkkhGMpAfs1e3UR5xRFQ68Kg`
(`https://orbsie-bp68azah1-grappeggias-projects.vercel.app`) aliased at
`https://orbsie.com`.

- Source provenance: `0c2381c`
- Root: HTTP 200
- Unauthorized generation-runs probe: HTTP 401
- Player runtime and five geometry/modeling workers: HTTP 200 with checked-in hash matches
- Browser smoke: canvas visible, expected prompt placeholder, no page errors, no external requests, no non-GET requests

Provider-logo asset GET checks from the production alias:

| Path | Status | Bytes | SHA-256 |
| --- | ---: | ---: | --- |
| `/providers/openai.svg` | 200 | 1775 | `a41e8e53b14ef686319ed1529066d6a3391aca77d7f6eaaa9f0783acc717375f` |
| `/providers/openrouter.svg` | 200 | 710 | `9f8667fad9f139af6f2805b29db419a4683766b218a2962f764cdcb20a96cb29` |
| `/providers/vercel.svg` | 200 | 178 | `27622083391fe7729d41233aa75e24fa6f7ea25b37f43f6cb1b7917f0be0a2dc` |

The verifier performs GET/HEAD-only checks and does not submit prompts or call
generation APIs. `report.json` and `landing.png` contain the sanitized smoke
evidence.
