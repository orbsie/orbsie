# Generation preflight release

Source `9b91fc7` deployed to `https://orbsie-e43bsak7e-grappeggias-projects.vercel.app`, aliased to `https://orbsie.com`. Full suite: 468 passed, 7 optional skipped. Production build passed.

`preflight.json` records both deployed catalog endpoints returning the exact Astra ID and capability metadata. Both generation endpoints reject a deliberately absent model with HTTP 400 and the preflight error. The test supplies only a synthetic key and never supplies valid inference credentials. Local route tests independently prove rejection happens before inference and before free quota is claimed.

`report.json` records the public homepage, anonymous journal denial, exact player/worker hashes and real-browser landing smoke. These checks do not establish successful provider inference or per-Orb publishing.
