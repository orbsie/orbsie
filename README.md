# Orbsie

A little world, made by you. An open-source experiment in conversational 3D creation, licensed under Apache 2.0.

**App:** https://orbsie.com · **Vercel:** https://orbsie.vercel.app · **Source:** https://github.com/orbsie/orbsie

## Run

Requires Node.js 22 and npm.

```sh
npm ci
npm run dev
```

Open the local URL printed by Next.js. `npm run build` builds both the editor and the independent player. `npm run typecheck` and `npm test` check the protocol and provider framing.

## What works in this first implementation

- Stylized rotating planet, continuous camera descent, persistent Three.js canvas.
- Genuine vertex interpolation from glowing seeds into trees, platforms, arches and other procedural objects, driven by validated fixture operations.
- A playable island with crystals, moving platforms, portal, reset, keyboard and touch controls; a second clickable flower garden.
- Object selection, scripted scoped demo revisions, undo/redo, stop, local IndexedDB recovery.
- Play links containing a compressed immutable snapshot (without conversation history), usable by signed-out visitors.
- Downloadable standalone game ZIP with player, project data, source, dependencies and build scripts. It runs without Orbsie APIs or AI credentials.
- Authenticated OpenRouter / Vercel AI Gateway NDJSON relay implementations and provider catalogs, plus optional Better Auth accounts, Postgres snapshots, and a dedicated-Vercel-project publishing adapter.

**The hosted default is an interactive fixture demo, not live AI generation.** Cloud accounts, AI generation and dedicated project publishing remain unavailable until their external configuration is supplied and tested. The initial brief is the target product; this approximately 30-minute implementation is its first reviewable slice. Read [verification](docs/verification.md) for evidence and gaps.

## Cloud configuration

Copy `.env.example` to `.env.local`, fill it privately, and configure the same variables in Vercel. Never commit credentials. Supply managed Postgres `DATABASE_URL`, a random `BETTER_AUTH_SECRET`, and `BETTER_AUTH_URL`. Then run:

```sh
npm run db:migrate
```

Better Auth owns its account tables; `scripts/schema.sql` adds Orbsie project/revision/publication tables. Email/password login is implemented; optional Google provider configuration is accepted by the auth server, but its UI is not yet exposed. Database migration and real authentication still require integration verification.

AI keys are entered in connection settings, kept only in tab memory, and sent to the authenticated server relay for the chosen provider. No remembered-key storage is implemented. Disconnect clears the tab's key. Model IDs are obtained from the provider catalogs rather than invented. NDJSON generation depends on the selected model following the framing instructions and needs live testing per model.

Dedicated publishing additionally requires `VERCEL_DEPLOY_TOKEN` and `VERCEL_TEAM_ID`; these are separate from an AI Gateway key. Save the current revision to the cloud first. Published Orbs get deterministic project names, owner-scoped database records, bounded account quotas, and independent static player files. This adapter needs live integration tests before opening a public beta. Play links and ZIP export do not require it.

## Deployment

```sh
vercel --prod --scope grappeggias-projects
```

The Vercel project is `orbsie`. Deployment currently uses the authenticated CLI. Automatic GitHub linkage was rejected because the Vercel account needs a GitHub Login Connection. Repository pushes work independently.

See [architecture](docs/architecture.md), [ChatGPT decision](docs/chatgpt-integration.md), and [verification](docs/verification.md).
