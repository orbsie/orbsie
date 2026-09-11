# Live production publication acceptance

Deployed source to production first: authenticated Vercel CLI (`vercel deploy --prod`, deployment `orbsie-29rse4uja`, aliased to `orbsie.com`); the deployed `modeling/worker.js` bytes match the local committed build, so `orbsie.com` serves the current main including twist/taper/vary.

Then a real end-to-end publication on production with a fresh account:

1. Sign-up over `/api/auth/sign-up/email` (session issued).
2. Cloud save of a deterministic protocol-geometry world (`tree`, `crystal`, `portal` at refined detail) via `PUT /api/projects` — revision 1.
3. `POST /api/publish` — the platform provisioned the Orb's own Vercel project and submitted the deployment (`/o/pub-accept-mtwcf5pk`, deployment URL `orb-7358ab08c5000df5a5cf-2oyrbpgf0-…`).
4. The deployment went live; a fully signed-out browser context (zero cookies) opened it: HTTP 200, `main[data-ready="true"]`, rendered canvas, no page errors. The sharing page resolves with title metadata.

Evidence: `report.json`, `signed-out-playback.png`. This closes the core release gate "Baked assets survive export and independent signed-out publication without authoring services or provider credentials" for protocol-geometry worlds on the deployed build: public play requires no Orbsie editor, no authoring kernel, no model credentials and no account.

Boundaries recorded honestly: the Orb was authored deterministically over the real API because production's free-prompt network quota was consumed that day (rate-bucketed, resets daily); model-backed world creation on production remains covered by the free-prompt evidence trail and the live provider runs. The status-polling fetch inside the driving script crashed client-side after submission; the deployment was verified independently. Production publication quota is 3 orbs per account.
