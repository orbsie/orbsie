# Build Orbsie

## Owner updates — 2026-09-07

- Remove user-facing demo mode. Every creation uses available free prompts or the linked API/account; otherwise preserve the prompt and ask for sign-in or a provider connection. Deterministic fixtures are test infrastructure only. This overrides earlier demo-mode requirements below.
- Commit and push coherent reviewed changes frequently throughout implementation.

- Keep Apache 2.0.
- Use GPT-6 Astra with low reasoning and regular/standard processing for the lead and all development-agent defaults. Disable Fast mode. Explicitly delegated Luna workers use GPT-5.6 Luna with xhigh reasoning and regular/standard processing. Orbsie calls use standard processing; live model tests remain Astra low. Speed tier is separate from reasoning effort.
- Continue implementation with Astra owning planning, integration, and quality, strategically delegating bounded work to Luna xhigh under the execution plan below. Use up to three parallel workers when independent tasks justify them, with frequent pushes to main. Use the owner's Google Cloud project `orbsie` for private object storage and Neon PostgreSQL for relational data.
- Present Quality, Balanced, and Budget creation modes with provider-verified model recommendations. Put the full compatible model catalog under Advanced.
- Center the prompt over the globe, remove Island/Garden selectors, use the exact placeholder "What experience to build?", and support microphone dictation.
- All live model-backed tests must use Astra with low reasoning effort. Discover the real model ID and fail rather than falling back. Deterministic unit/browser checks do not call a model.
- Initial delivery is approximately 30 minutes of implementation, with frequent GitHub pushes and deployment to the Orbsie Vercel app.
- The entrance planet should occupy roughly 80% of the viewport. Use a dark, space-like background.
- Remove approximately 80% of visible text and interface clutter. Focus on the planet and essential creation controls; omit landing branding, early-access labels, marketing headings and taglines.


## Development execution and quality plan

1. Astra low/regular owns the task breakdown, architecture, shared interfaces, acceptance criteria, and final delivery. Before delegation, inspect the relevant code and specify the intended behavior, file ownership, constraints, and required evidence.
2. Offload independent, bounded work to Luna xhigh/regular: focused investigations, isolated implementation with an agreed contract, targeted regression checks, and documentation grounded in verified behavior. Use the `luna_worker` role where supported, or explicitly select `gpt-5.6-luna` and `xhigh` when spawning. All other agents default to Astra low/regular.
3. Parallelize only disjoint work that lets Astra make useful progress on integration or another task. Avoid overlapping file ownership, speculative tasks, and delegation whose coordination cost exceeds the work. Workers report changed files, checks run and their results, unresolved risks, and assumptions.
4. Astra reviews every delegated diff against the requirements and surrounding code, checks failure paths and regressions, and requests corrections or takes over when evidence is weak. Keep ambiguous product decisions, cross-cutting architecture, authentication/data-boundary decisions, and final visual judgment with Astra. Worker completion alone is not acceptance.
5. Astra integrates accepted changes and verifies the combined result with the relevant tests, type/build checks, and real-browser review for user-facing changes. Confirm the intended interaction and visual quality; distinguish deterministic checks from live-provider evidence. Live model-backed tests retain the owner's Astra-low constraint.
6. Astra owns the final quality decision and delivery report, including evidence and remaining limitations. If Luna repeatedly misses the contract or needs broad context, move that task back to Astra instead of expanding delegation. Keep regular processing for every development agent.

You are the implementation agent for Orbsie. Act as a product-minded full-stack engineer and a skilled interactive 3D designer. Build the product described below, verify it in a real browser, and leave a working, reviewable implementation. Do not stop after producing another plan.

This is the complete project brief. You do not need the originating conversation.

## 1. Product, ownership, and delivery scope

- Product name: **Orbsie**. The owner has purchased **orbsie.com** and owns the GitHub organization **https://github.com/orbsie**. The intended platform production URL is **https://orbsie.com**; connect it to the platform's Vercel project using verified account/domain configuration when access is available.
- Build an Apache-2.0-licensed, open-source web application hosted on Vercel. Inspect the supplied repository and its instructions first. If starting from an empty workspace, use `orbsie` as the application/repository name; the intended repository is `orbsie/orbsie`, but do not assume it already exists.
- Audience: nontechnical people. Think of the accessibility of Lovable applied to small 3D games and interactive scenes. Users create, revise, play, and share their **Orbs**.
- The defining feature is an incremental, responsive creation experience: objects arrive as glowing spheres and visibly evolve into their final shapes while the scene remains usable.
- Each Orb is an independent project. The planet and parcel metaphor gives each creator a place to make something. For the initial release, parcels are a visual metaphor for independent projects, not a shared multiplayer simulation or a land marketplace.
- Deliver a **polished, working vertical slice with basic accounts**: prompt → streamed creation → playable preview → object-specific revision → saving → publishing → opening the public game. This resolves an ambiguous final scope answer in favor of a complete core experience.
- Build toward a small beta, but put visual quality and responsiveness ahead of a large feature inventory. Full social feeds, billing, collaboration, multiplayer, and marketplaces are later work.
- Make routine implementation decisions yourself and record meaningful assumptions. Use available authorized access for GitHub/Vercel operations. Preserve existing repositories, projects, and DNS configuration. If external credentials or configuration are missing, finish the local implementation and document exactly what remains unverified; do not claim a deployment or integration succeeded without evidence.

## 2. Nonnegotiable experience

The application should feel like bringing a tiny living world into existence.

1. The initial screen is dominated by a slowly rotating, glowing planet.
2. A floating prompt composer sits over the planet. It is the obvious way to begin.
3. Submitting a prompt starts generation and a continuous visual transition at the same time.
4. The composer drifts to the left and becomes the chat/history panel. Preserve the actual prompt, focus, and conversational continuity.
5. The planet rotates to reveal a chosen parcel, and the camera moves toward that location.
6. As the camera approaches, the parcel resolves into a locally flat, usable game area. The user should feel they landed on the planet, not switched to an unrelated page.
7. New objects appear at their intended locations as glowing orbs, then progressively change silhouette, material, and detail until they become the requested objects.
8. The user can play and request further changes while creation continues. Completed parts of the scene stay responsive.
9. Clicking an object highlights it and allows an instruction such as “make this taller,” “turn this into a mushroom,” or “make this platform move.”
10. Publishing creates a real, independently accessible game URL.

A generic chat interface beside a blank canvas, a loading spinner followed by a finished scene, or an animation applied only after the whole game is generated does not satisfy this brief.

## 3. Visual direction and language

Bright, alive, and cosmic. Use sunlit turquoise oceans, lush greens, soft atmospheric blue, warm highlights, and restrained lilac or coral accents. The surrounding space can be softly celestial, but the overall experience must not feel like a dark developer dashboard.

Give the planet real depth: atmosphere, soft cloud movement, rim light, gentle rotation, and hints of land and life. Prefer an art-directed stylized planet over a photorealistic Earth. Keep bloom selective so typography and controls remain crisp.

Use rounded, confident typography, generous spacing, and a floating, lightly translucent composer with strong contrast. Avoid a dense navigation bar and a conventional marketing hero full of feature cards. The planet is the product entrance.

Suggested starting copy:

- Heading: **A little world, made by you.**
- Composer placeholder: **What would you like to bring to life?**
- Action: **Create an Orb**
- Example prompts: **A tiny island treasure hunt**, **A bouncy space playground**, **A garden that responds to music**.

These are editable product copy, not rigid requirements. In user-facing controls say “Orb,” “Create,” “Play,” “Change this,” “Publish,” and “Share.” Keep scene graphs, patches, JSON, deployments, and compiler output in developer diagnostics. Provider names and credentials belong in connection settings, where users need them.

## 4. Planet-to-parcel transition

Use a persistent renderer and scene lifecycle. Keep the canvas mounted through the landing, descent, editing, and play states. Drive camera movement and UI movement from one coordinated transition controller.

- Anchor the parcel to a stable point and tangent basis on the planet. Orient the planet toward that point before descent, decelerating rotation as the workspace becomes active.
- Blend from globe scale to a detailed local patch with matching colors, lighting, horizon, and terrain. A flat local coordinate system is appropriate for physics and editing. Use geometry blending, level of detail, atmospheric occlusion, and camera framing to conceal the scale change smoothly.
- Do not simulate planetary gravity or continue rotating the playable ground underneath the player.
- Start generation immediately; do not wait for the camera animation or a complete game plan.
- Let the prompt move left over approximately 0.7–1.0 seconds and the initial descent take approximately 3–5 seconds. Treat these as tunable art direction. Do not artificially hold ready content behind a timer.
- The chat panel should settle around 320–380 px wide on desktop; the scene occupies the rest. Maintain comfortable framing as the viewport changes.
- Provide a small “Back to planet” control. Existing Orbs should reopen directly in their workspace, with a short optional arrival transition rather than repeating the full introduction.
- On small screens, use a collapsible bottom chat sheet so play remains practical. Respect reduced-motion preferences and provide a clear unsupported-WebGL fallback.

Implement explicit UI states such as landing, descending, building, editing, playing, and publishing. Build progress and camera progress are independent; a network delay must not freeze the interface.

## 5. Objects form from orbs

Create a reusable `OrbFormation` system. It is a core product component, not decorative polish added at the end.

An entity should have a stable ID and progress through states such as reserved → seed orb → coarse form → refined form → ready. A reservation appears when the model has actually identified an object and its placement. Refinements should arrive as separate validated operations when possible, so the user sees genuine incremental work.

- Spawn the seed at the intended position and approximate footprint. Use a subtle pulse and bounded growth rather than intrusive flashes.
- Morph the silhouette visibly. For compatible procedural meshes, use vertex correspondence or a deformation shader. For complex multipart shapes, use a deterministic GPU particle/surface bridge from a sphere into the target, followed by solidification. A simple opacity crossfade between two unrelated meshes is insufficient.
- Treat a semantic object, such as a tree, as one formation event even when it contains a trunk and several foliage meshes.
- Build and demonstrate at least three convincing formation families: an organic object, a hard-surface object, and a multipart structure. Trees, platforms, and a bridge or arch are good starting cases.
- Refinements should transform the current visible form toward the next form, rather than restarting the whole animation. Preserve location, scale intent, object identity, and selection.
- Existing-object edits should be equally satisfying: recolor smoothly, grow a tree, or transform a static platform into a moving one without recreating unrelated objects.
- Prepare geometry away from the main interaction loop; animate interpolation on the GPU or lightweight render-loop paths. Reuse resources and release obsolete geometry/materials.
- Aim for approximately 0.6–1.2 seconds for a typical shape transition, overlapping independent objects. Coalesce rapid refinements so visual animation does not become a backlog.
- Keep unfinished forms identifiable as previews. Apply gameplay/collider changes only at valid simulation boundaries; do not knock the player through the floor because a mesh is being replaced.
- Canceling or failing a generation should preserve completed changes and restore or remove unfinished previews coherently.

Do not imply that the model is streaming finished geometry when it is only streaming prose. The visible pipeline must be driven by actual object reservations, geometry recipes, and revisions. Deterministic replay of this pipeline is permitted only in test infrastructure, never as a user-facing generation mode.

## Curated 3D asset collection — owner addition

- Download and maintain a curated local collection of high-quality 3D models from verified original sources with permissive licenses allowing redistribution and commercial use. Preserve the exact license text, author attribution when required, original source URL, version/download date and integrity hash for every asset. License compatibility is an acceptance gate, not an assumption based on a search label.
- Favor visually consistent stylized assets suitable for Orbsie's aesthetic, with reviewed polygon counts, texture sizes, materials, origins, scale and colliders. Optimize and cache assets for responsive loading while retaining license/provenance alongside originals and distributed derivatives.
- Add a bounded, typed catalog and asset-reference path to the authoring protocol and standalone player. Models may choose catalog assets when they fit the request, and generate new procedural geometry for novel or customized content. Support a useful mix and alternate between prepared assets and new geometry where appropriate; never restrict a world to the catalog or force inappropriate substitutions.
- An explicit request for new/original models overrides the collection for the scope of that request. Carry this constraint in generation context and enforce it when validating operations, including follow-up turns. Do not silently select a catalog asset for an object that the user asked to generate anew.
- Keep genuine incremental reservations/formation for both paths. Load/decode heavy assets away from interaction-critical work; cache/preload only bounded useful assets. Preserve stable IDs, selection, gameplay and smooth revisions when moving between catalog and generated geometry.
- Public deployments and independent ZIP/source exports must include all referenced assets and their licenses/attribution, with no dependence on the editor or third-party download URLs. Unknown catalog IDs and arbitrary model-supplied remote URLs must be rejected.
- Verify catalog-only, mixed and explicitly-new workflows with real providers and deterministic regressions. Measure first usable content and interaction responsiveness against the procedural-only baseline; do not claim faster generation solely because a catalog exists.

Implementation order and acceptance gates:
1. Acquire a small coherent collection, review rendered previews and technical budgets, and verify original-source licenses and hashes before admitting assets to the catalog.
2. Add typed local asset references, asynchronous loading, shared formation/selection/collider behavior, and license-preserving export/publication packaging.
3. Add a request-scoped asset policy to generation and validation. Prefer a useful alternation of prepared and newly generated models across eligible objects, without a fixed quota that harms prompt fidelity. Explicit new/original requests take precedence over speed and reuse, including retries and follow-up edits; unrelated existing assets need not be replaced.
4. Test mixed scenes and rejection of catalog references in new-only scopes, then compare first usable content and input responsiveness against the same procedural-only requests. Ship the runtime integration only after standalone exports retain the referenced models and licenses and these checks pass.

Downloaded files alone do not complete this feature. Track acquisition, runtime integration, policy enforcement, export integrity and measured responsiveness as separate completion gates.

## 6. Incremental authoring architecture

Choose a persistent scene runtime with streamed, validated operations as the fast path. Do not regenerate a whole web application, run a server build, or reload the preview for each edit.

Use a versioned, typed intermediate representation containing:

- Scene/environment settings and a project seed.
- Entities with stable IDs, transforms, semantic labels, geometry recipes, materials, and optional physics.
- Composable game behavior: inputs, variables, conditions, triggers, actions, timers, movement paths, collisions, scoring, win/lose states, and reset behavior.
- Asset references with explicit ownership and dependencies.
- A revision history and the metadata needed to export the project independently.

This representation must support new combinations, shapes, and rules authored by the model. It must not merely select among a handful of canned games. Use parametric geometry, combinations of primitives, paths/extrusions, and reusable behaviors to produce varied stylized scenes quickly. Keep an extension boundary for custom scripts and imported/generated assets; the first release need not depend on a slow external text-to-3D service.

Implement a small set of model tools or framed commands, for example:

- `reserve_entity`: semantic object, placement, bounds, and stable ID.
- `set_geometry`: a coarse or refined validated recipe for an entity.
- `set_material`, `set_transform`, `set_behavior`, `set_environment`.
- `remove_entity`.
- `commit_revision`, plus a concise user-facing explanation of the change.

Translate provider output into a provider-neutral event envelope. Include protocol version, project ID, run ID, unique operation ID, sequence, and expected base revision. Validate both syntax and semantics before applying changes. Reject unknown entity references, nonfinite transforms, excessive geometry, and invalid behavior dependencies.

Use complete validated tool-call arguments or complete framed records. Never execute or apply a half-parsed JSON fragment just because it arrived in a token stream. A provider adapter must declare whether its chosen model supports the necessary streaming/tool/schema capabilities; handle unsupported models clearly. OpenRouter documents model-dependent structured-output support and streaming. [Structured outputs](https://openrouter.ai/docs/guides/features/structured-outputs), [streaming](https://openrouter.ai/docs/api_reference/streaming).

Small coherent transactions should become visible as soon as their dependencies are valid. A user turn can contain many committed increments. Keep pending visual reservations distinct from committed scene state. Use idempotency, ordering, and revision checks so retries cannot duplicate objects and stale runs cannot overwrite newer edits.

Preserve the last valid scene on errors. Store committed checkpoints and support reconnect/resume from a known sequence or regeneration from a checkpoint. Do not assume a model stream can resume at the provider level. Respect finite Vercel function lifetimes by bounding turns and checkpointing work; do not rely on in-memory background work surviving an HTTP request. [Vercel runtimes](https://vercel.com/docs/functions/runtimes).

## 7. Editing and playing

The principal tools are conversation and direct object selection, not a traditional game-engine editor.

- Clicking an editable object gives it a tasteful outline/halo and a small “Change this…” composer. Include an object chip in the conversation, such as `Tree`, with the stable entity ID retained internally.
- Send the selected entity, relevant neighboring objects, current revision, and the user's instruction as scoped context. Preserve surrounding layout and gameplay unless the user requests a broader change.
- Provide simple Play/Edit controls. Default camera/input behavior should make it easy to inspect while editing and actually play the game when requested. Text entry must not accidentally move the character.
- Allow play while generation continues. Preserve player position, score, timers, camera, and unrelated objects across compatible patches. Separate authored state from transient play-session state.
- When an edit inherently changes the rules or removes ground underneath the player, reconcile explicitly and safely; use a checkpoint or a small reset notice where a reset is unavoidable.
- Provide Undo/Redo or a simple revision history. Support stopping generation, retrying a failed change, and returning to the last working revision.
- Support follow-up prompts during a run. A simple explicit cancel-and-replan or queue policy is acceptable initially; prevent concurrent writers from corrupting the same revision.
- Include keyboard controls and touch controls for the initial playable demo. Public players should not need an Orbsie account or an AI key.

## 8. Suggested implementation stack

Use existing compatible project conventions where present. For a new repository, prefer:

- Next.js, TypeScript, React, and Vercel for the app and thin server routes.
- Three.js with React Three Fiber for the persistent scene; a small amount of custom GLSL for atmosphere and formation effects.
- Tailwind CSS plus Motion or an equivalent lightweight animation library for the composer and panel transitions.
- Zustand or an equivalent lightweight store, with transient per-frame state outside React rerenders.
- Zod for protocol and project validation.
- Vercel AI SDK where it simplifies provider adapters and tool streaming. Use the official/provider-maintained OpenRouter integration or a well-tested compatible transport.
- IndexedDB for local drafts, a replayable operation log, cached assets, and recovery after refresh.
- A managed Postgres database available through Vercel's ecosystem for accounts/project metadata and cloud checkpoints, and object storage for larger assets/thumbnails. Prefer a small Drizzle schema and a maintained auth library. Google sign-in is a reasonable nontechnical default.
- A browser physics engine such as Rapier only where needed by the gameplay. Lazy-load expensive components.
- Vitest for protocol/state logic and Playwright for end-to-end and visual verification.

Verify current official package compatibility before installing and commit a lockfile. Keep versions explicit. Prefer WebGL2 compatibility for the first release; WebGPU may enhance the experience but must not be the only working path.

Rendering, physics, geometry preparation, camera control, previews, thumbnails, most caching, and feasible export assembly belong on the client. Use workers for expensive geometry or behavior work. The server handles authentication, provider relaying, durable cloud data, and deployment control. Never expose secrets in order to move work to the browser.

### Local background model building — owner addition

- Use the user's local CPU/GPU for rendering generated and catalog assets and for background model construction. Keep the editor interactive while jobs run; use bounded worker queues, cancellation, resource budgets and progress driven by actual job stages. Local construction does not imply that the language model itself runs locally.
- Ship an optional local companion containing a version-pinned, minimal headless Blender distribution with the modeling, Python automation and GLB export features needed by the app. Measure installation size, cold-start time and memory before describing it as minimal; remove only components proven unnecessary by the modeling/export acceptance suite. Keep browser delivery small with an explicit companion installation and capability handshake, rather than assuming a native executable can run inside a web page.
- Let the LLM construct genuinely new models through validated modeling jobs executed by Blender in the background on the user's computer. Support new shapes and multipart construction beyond the curated collection. Return validated GLBs, bounds, material data, thumbnails and provenance into the existing reservation/formation/revision pipeline; persist completed results and include them in standalone exports and publication.
- Run generated modeling work in an OS-isolated job process with a temporary working directory, no credentials or unrestricted host-file/network access, strict time/memory/output limits and cancellation. Prefer a typed modeling program translated by trusted code; any generated Python requires the same isolation, not merely a worker thread. Do not silently execute arbitrary model output in the user's normal Blender session.
- Preserve Blender's GPL notices, dependency licenses, corresponding source and build instructions required for the shipped binaries. Track generated artwork provenance separately from the Blender software license. Official references: https://www.blender.org/about/license/ and https://docs.blender.org/manual/en/latest/advanced/command_line/render.html.
- Prefer a useful mix of catalog reuse, immediate procedural geometry and locally built Blender models. Explicit requests for new models override catalog reuse. If the local builder is unavailable, show that capability honestly and retain the supported browser generation path; do not imply a Blender job ran or silently replace an explicitly requested Blender workflow.
- Acceptance requires a real LLM-to-local-Blender-to-browser scene/edit/export round trip, installation and restart checks on each declared supported platform, cancellation/failure recovery, isolation tests, and measured editor responsiveness during background construction. Downloading Blender or rendering a prebuilt fixture alone does not satisfy this requirement.

Implementation sequence and completion gates:

Delivery contract: local rendering is the default for every asset source. The optional Blender companion is a downloadable client installation; it must include its verified runtime so users do not need to install or configure Blender separately. Background construction must work without opening Blender's desktop interface. A developer machine's existing Blender installation or an unpruned packaging prototype does not satisfy the shipped-runtime gate.

“Optional” describes the user's choice to install the companion; delivering the packaged companion is mandatory project scope. Client-side construction means execution on the user's computer through that companion, while the browser renders the resulting assets locally. The installer must also supply any launcher runtime it needs so a nontechnical user does not need Node, Python, a repository checkout or developer tools.

Schedule construction below interactive rendering: begin with one active Blender job and a bounded pending queue, retain the last usable asset during builds, and expose cancellation. Increase concurrency only when measurements show that camera movement, selection and editing remain within the declared responsiveness budgets. Use available local GPU capabilities for rendering; do not assume every Blender modeling operation benefits from GPU execution.

1. Keep generated assets rendering on the browser's GPU. Move expensive decoding and geometry preparation off the UI thread where supported, and measure frame responsiveness while background construction runs.
2. Build and validate the bounded, data-only modeling protocol and isolated Blender executor. Cover custom meshes, extrusions, surfaces of revolution and multipart models; validate exported geometry and resource limits before loading it into the scene.
3. Package the smallest verified runtime with an installer, version/capability handshake, integrity checks and required license/source materials. Record download size, installed size, cold start and peak memory; publish a supported-platform matrix based on actual installation tests.
4. Connect LLM modeling requests to the local job queue, show real progress and cancellation, and atomically replace previews only after a result passes validation. Preserve the previous usable model on failure. Persist the resulting GLB and provenance through reload, scoped edits, export and publication.
5. Run the complete real-provider flow on the packaged runtime, including a request that explicitly forbids catalog reuse. Astra reviews worker changes and the acceptance evidence before marking any gate complete; Luna can implement independent executor, packaging and integration tasks in parallel.

Record a repeatable baseline on declared test hardware: idle editor versus active modeling, frame-time percentiles, input latency, peak CPU/RAM/GPU memory where measurable, job duration, cancellation latency, download and installed size. Set explicit budgets from these measurements before release, and demonstrate that camera movement, selection and editing remain usable during construction. Keep runtime packaging, local rendering, background modeling, persistence/publication and responsiveness as separate tracked acceptance gates.

Organize code around clear modules: app shell, planet/transition, formation renderer, scene runtime, protocol/reducer, generation adapters, persistence, export, and publishing. The runtime and project schema must be reusable in standalone game exports.

Three.js supports geometry attributes and morph targets; manage geometry lifecycles carefully rather than mutating already-rendered morph data indiscriminately. [Three.js BufferGeometry](https://threejs.org/docs/pages/BufferGeometry.html).

## 9. AI connections

Implement these as separate provider connections behind the same generation contract:

1. **OpenRouter API key:** required working provider path.
2. **Vercel AI Gateway API key:** required working provider path. A Gateway key is distinct from a Vercel deployment token. Official Gateway documentation describes its authentication options and OpenAI-compatible endpoints. [Authentication](https://vercel.com/docs/ai-gateway/authentication-and-byok), [compatible API](https://vercel.com/docs/ai-gateway/sdks-and-apis/openai-chat-completions).
3. **ChatGPT subscription through a supported Codex integration:** preferred experience, requiring an explicit feasibility spike.

For ChatGPT: official Codex App Server documentation includes managed ChatGPT login and integration-oriented account APIs, while Codex authentication documentation cautions against exposing Codex execution in public/untrusted environments. These sources do not, by themselves, establish a turnkey public, multitenant Orbsie integration. Evaluate current documented access, isolation, credential lifecycle, and hosting requirements. Do not treat subscription credentials as ordinary OpenAI API keys. Do not build authentication from copied cookies or undocumented endpoints. [Codex App Server](https://learn.chatgpt.com/docs/app-server), [Codex authentication](https://learn.chatgpt.com/docs/auth).

If a supported ChatGPT route can be demonstrated, implement it behind an adapter. If it requires a trusted local companion or a separately hosted isolated service, document that tradeoff rather than making it a hidden dependency of the Vercel app. If it cannot be verified in this environment, keep its adapter boundary and a documented integration plan, and ship the two working API-key paths. Do not render an enabled “Connect ChatGPT” control that cannot complete authentication.

Let users select a provider and a supported model in settings. The owner's original motivation included Astra's modeling capability: prefer it where the actual provider catalog offers a suitable version, but verify the real model ID and capabilities. Never invent IDs or silently substitute a provider/model with different billing.

Store credentials outside the project document. Keep keys out of prompts, generated code, browser bundles, localStorage, exported projects, and logs. Use an authenticated server relay; make remembered credentials opt-in and encrypted server-side. A session-only credential path is appropriate initially. Disconnect must revoke Orbsie's access to the stored credential.

Preserve the initial prompt if authentication or AI setup is needed. Visitors create using available free prompts or a linked provider/account; otherwise request connection or sign-in without discarding their prompt. Show useful connection, quota, and retry messages with the user's existing Orb preserved.

## 10. Independent projects and Vercel publishing

Interpret “each game is a subproject within Vercel” as **one Vercel Project per published Orb under the configured Orbsie team**, linked to the parent app in Orbsie's own database. Drafting and local previews must not require provisioning a Vercel project.

- Provision the game's Vercel project on first publish. Publish later revisions as deployments of that same project.
- Use stable IDs and persist project/deployment mappings. Serialize concurrent publish attempts per Orb and make retries idempotent. Avoid duplicate Vercel projects after timeouts.
- Default to static, client-rendered game output. Ship only a runtime, the committed scene/behavior snapshot, and required assets. Public games must run without Orbsie editor services or model credentials.
- Produce an independent source export with package metadata, pinned runtime dependencies, project data, assets, a README, and build/run scripts. Vendor the necessary runtime source or reference an actually published package; do not leave broken dependencies on unpublished workspace packages. Do not export only a URL back to the editor.
- Capture a specific committed revision for publication. Further editing must not change an in-flight artifact. Keep the previous public release working until the new deployment is ready.
- Use the Vercel deployment API or supported SDK, report queued/building/ready/error truthfully, persist progress, and reconnect to status after browser refresh.
- Return the actual deployment URL and verify public playback. Handle deployment protection explicitly so a “public” shared game can be opened in a signed-out browser.
- Use a stable Orbsie sharing page such as `/o/{slug}` for title, thumbnail, creator, and a link or isolated embed of the independent game. Add a lightweight “Make your own” action. A full discovery feed is outside the first delivery.
- Keep deployment credentials in the server only. Apply project ownership checks, reasonable configurable publish quotas, and clear handling of Vercel limits or rate limits.
- Keep the platform repository public/Apache-2.0. Do not automatically publish users' private drafts or credentials into that repository or create a public GitHub repository for every user project.

The API documents creating projects in a team scope and deploying files through Vercel. Verify the currently supported request shapes during implementation. [Create project](https://vercel.com/docs/rest-api/projects/create-a-new-project), [deployment workflow](https://vercel.com/docs/deployments).

## 11. Accounts, saving, and trust boundaries

Basic accounts and cloud saving are part of this delivery, but the first screen should remain an invitation to create. Permit a real locally saved draft before sign-in; request sign-in when cloud ownership or publishing is needed. Keep Orb content intact through that flow.

Store users, projects, chat messages with entity references, committed revisions, generation runs/checkpoints, assets, and publication mappings. Scope every read/write to its owner or explicit public visibility. Account identity is separate from the user's AI provider connection.

Keep a local durable copy of edits and reconcile with cloud revisions. Make a single active writer the initial collaboration model and handle another tab editing the same project without silent data loss.

Generated material is untrusted. For the first version, interpret a bounded, validated scene/behavior language in trusted runtime code. Do not `eval` model output in the authenticated application's origin. If adding arbitrary generated JavaScript, isolate it in a separate-origin sandbox with constrained messages/network capabilities and execution budgets; workers help responsiveness but are not sufficient isolation by themselves. The complete planet-to-parcel renderer must still persist if an isolated preview frame is used.

Bound geometry complexity, object counts, asset sizes, behavior steps, and recursive structures. Validate asset sources and prevent arbitrary server-side fetching. Public game origins must receive neither editor credentials nor broadly scoped authentication cookies. These controls protect the actual generated-content and publishing paths, not a separate administrative checklist.

## 12. First demonstration and acceptance story

Use this as the flagship scenario, with deterministic fixtures and real-model runs:

**Initial prompt:** “Make a sunny little island game where I collect five glowing crystals, bounce across three moving platforms, and reach a portal. Add friendly trees and a pond.”

The experience should unfold visibly:

1. The prompt becomes the first chat message as the camera descends onto a parcel.
2. Reserved trees, crystals, platforms, and the portal appear as seed orbs at sensible positions.
3. Those orbs develop into recognizable coarse objects and then their final stylized forms.
4. Basic movement works as soon as the ground and player are ready. Scoring, platforms, and the portal become functional as valid behaviors arrive.
5. The user collects crystals and can win/reset the game.
6. Clicking a tree and asking “Make this a giant pink mushroom” changes that object while preserving the rest of the world.
7. Asking “Make the middle platform slower and add two more crystals” changes targeted behavior and reconciles the collection goal appropriately.
8. Undo restores the previous committed change. Refresh recovers the saved project.
9. Publish produces a real URL; a signed-out visitor can play the same revision without an AI key.

Also demonstrate a different interactive scene, such as a garden whose flowers open when clicked, to prove the system is not hardcoded to the island game.

## 13. Performance and verification

Instrument the experience rather than claiming fixed model latency.

- Target input feedback within 100 ms and display a valid incoming scene update within roughly 100 ms of validation/worker completion under the representative test load.
- Target smooth 60 fps on a normal recent laptop, with adaptive quality and a usable 30 fps path on weaker devices. Record the device, scene complexity, frame-time distribution, and browser used; these are goals, not unmeasured promises.
- Measure prompt submission, first semantic entity reservation, first visible seed, first usable controls, first playable objective, generation completion, and publish readiness separately.
- Keep the camera and chat responsive during geometry preparation. Cap device pixel ratio, reuse or instance repeated objects, and avoid pushing animation state through React every frame.
- Validate cancellation, stream interruption, duplicate/out-of-order operations, stale revisions, invalid geometry, selected-object edits, undo, refresh recovery, and failed publication preserving the last public version.
- Test the core flow with fixture events, then test each implemented provider with real credentials when available. Clearly distinguish fixture coverage from live provider coverage.
- Verify generated content cannot access account/provider secrets or escape its execution contract.
- Verify the independent export builds and plays without the editor. Verify the published URL in a signed-out context when deployment credentials are available.
- Use actual browser interaction and visual inspection at desktop and mobile widths. Capture the landing, descent, a visible intermediate morph, editing, and public playback. Static endpoint screenshots alone cannot prove formation; provide a short recording when the available tooling supports it.

## 14. Execution order and deliverables

Work in these milestones, keeping the application runnable at each stage:

1. **Experience prototype:** planet, composer, continuous descent, flat parcel, persistent renderer, and three convincing orb-to-object formations driven by fixture events. This establishes the visual standard early.
2. **Authoring runtime:** typed project format, incremental operations, scoped object selection, behaviors, physics/input, undo, local recovery, and the complete playable fixture.
3. **Real generation:** working OpenRouter and AI Gateway connections, streaming tool/event adapters, provider/model checks, checkpoints, cancellation, and real incremental revisions. Complete the early ChatGPT integration feasibility spike without blocking these paths.
4. **Ownership and publication:** basic accounts, cloud saving, independent project export, one Vercel Project per published Orb, deployment status, and public sharing.
5. **Finish and prove:** visual refinement, responsive/touch behavior, reduced motion, performance measurement, targeted tests, a second scene type, and deployment verification where access exists.

Deliver:

- Working source with an Apache 2.0 license, a lockfile, and a clear README.
- `.env.example` with placeholders only and setup instructions for the app auth provider, database/storage, credential encryption, Vercel team/deployment access, and optional AI test credentials. Distinguish deployment tokens from AI Gateway keys.
- A short architecture document explaining the scene/operation protocol, formation system, local/cloud responsibilities, standalone export, and publishing mapping.
- A concise ChatGPT integration decision note citing current official documentation and stating what was implemented or remains conditional.
- A test/verification report that separates deterministic fixture, live provider, account, export, and cloud deployment evidence.
- Screenshots and a short interaction recording where supported.
- A final handoff listing actual repository/preview/deployment URLs, how to run locally, measured limitations, and any specific missing external configuration.

The success criterion is simple: a nontechnical person describes a small experience, lands on their parcel, watches objects grow from orbs, plays while the world develops, changes an object by talking to it, and shares a real playable Orb.
