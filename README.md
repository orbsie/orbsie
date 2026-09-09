# Orbsie

A little world, made by you. An open-source experiment in conversational 3D creation, licensed under Apache 2.0.

**App:** https://orbsie.com · **Also:** https://orbsie.app · **Vercel:** https://orbsie.vercel.app · **Source:** https://github.com/orbsie/orbsie

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
- Quality / Balanced / Budget modes backed by live provider catalogs, with all compatible models under Advanced.
- OpenRouter / Vercel AI Gateway generation with your own key, optional account/cloud-save recovery, and publication status with stable public sharing pages.
- Trusted local ChatGPT test harness: actual Astra low scene creation and scoped edits verified.
- Private Google Cloud Storage archives using keyless Vercel workload identity, with separate production/development buckets.

The hosted Gateway Luna path has passed three real free prompts and a blocked fourth request. The shared credential is private in Vercel, with database-enforced quotas. Email/password accounts, cloud saving and private archives are also verified in production; dedicated Orb publication is blocked by the publishing token’s project-creation permissions. The initial brief remains the target product; this is a tested implementation in progress. Read [verification](docs/verification.md) for evidence and gaps.

## Cloud configuration

Copy `.env.example` to `.env.local`, fill it privately, and configure the same variables in Vercel. Never commit credentials. Supply managed Postgres `DATABASE_URL`, a random `BETTER_AUTH_SECRET`, and `BETTER_AUTH_URL`. Then run:

```sh
npm run db:migrate
```

Better Auth owns its account tables; `scripts/schema.sql` adds Orbsie project/revision/publication tables; migrations also install trial quota and Plus waitlist tables. Email/password login is implemented; optional Google provider configuration is accepted by the auth server, but its UI is not yet exposed. Production and development Neon migrations passed, and real production authentication/save/recovery checks passed.

AI keys are entered in connection settings, kept only in tab memory, and sent to the server relay for the chosen provider. Generating with your own key does not require an Orbsie account; signing in is needed to publish. Signed-out work saves locally. No remembered-key storage is implemented. Disconnect clears the tab's key. Model IDs are obtained from the provider catalogs rather than invented. NDJSON generation depends on the selected model following the framing instructions and needs live testing per model.

Dedicated publishing additionally requires `VERCEL_DEPLOY_TOKEN` and `VERCEL_TEAM_ID`; these are separate from an AI Gateway key. Save the current revision to the cloud first. Published Orbs get deterministic project names, owner-scoped database records, bounded account quotas, and independent static player files. The configured token currently receives HTTP 403 when creating a Vercel project; publication and republishing still need live verification after its permissions are corrected. Play links and ZIP export do not require it.

## Deployment

```sh
vercel --prod --scope grappeggias-projects
```

The Vercel project is `orbsie`. Deployment currently uses the authenticated CLI. Automatic GitHub linkage was rejected because the Vercel account needs a GitHub Login Connection. Repository pushes work independently.

See [architecture](docs/architecture.md), [infrastructure](docs/infrastructure.md), [model recommendations](docs/model-recommendations.md), [ChatGPT decision](docs/chatgpt-integration.md), and [verification](docs/verification.md).

Historical local ChatGPT harnesses (`scripts/run-local-chatgpt.mjs` and `scripts/run-flagship-chatgpt.mjs`) require managed Codex login and do not satisfy the browser-only product connection requirement. Authorized live runs explicitly select `gpt-5.6-luna`, low reasoning and standard processing, with no model fallback; they consume model usage. Deterministic `npm test` does not. Development configuration uses Astra low with one Luna xhigh worker at a time and Fast mode disabled.

For the separately authorized OpenRouter test credential, use only `openai/gpt-5.6-luna`: `node --env-file=.env.openrouter.local scripts/verify-openrouter-luna.mjs`. The private file is Git-ignored and mode0600. The script makes one request capped at512 output tokens, with no model substitution or retry; it is separate from the Astra-only ChatGPT harness. The first request returned HTTP402; a second reached Luna but failed command-schema validation. No successful OpenRouter scene is claimed. Diagnostics are now retained privately before assertions.

Free visitors use server-owned Luna independently of paid presets: Quality Astra, Balanced Luna, Budget GLM-5.3-Flash. See [free prompt enforcement](docs/free-prompts.md) and [Plus waitlist delivery](docs/waitlist.md). Waitlist email delivery awaits the account owner’s Resend terms acceptance and verified sender setup; saved signups remain pending meanwhile.
