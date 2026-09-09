# Browser-first modeling delivery plan

Owner direction incorporated September 2026. This is an implementation plan, not a completion report. `prompt.md` remains the overall product contract. Latest owner requirement: modeling runs only with local browser resources; no Blender connection or companion may be required or surfaced. Native Blender prototypes are historical experiments and are excluded from product delivery. Any optional backend described below must execute within the browser.

## Architecture and ownership

The persistent Three.js scene owns rendering, formation, selection and play. A small provider-neutral Orbsie SDK owns model-facing authoring operations; geometry backends implement that contract. Hosted inference requests tools, while validation, modeling, feasible physics and rendering execute on the client. End users may select any supported model; live development inference remains Luna-only.

Store recipes as editable, versioned source and meshes as cached derived artifacts. Keep stable entity and recipe-node IDs, revision preconditions, seeded randomness, materials and behavior references. Canonical units are meters, Y-up and radians; primitives are centered unless a recipe explicitly specifies another origin. Backend adapters translate conventions.

Separate four responsibilities:

| Layer | Contract |
| --- | --- |
| Authoring state | Recipes, parameters, stable IDs, revisions, materials and behaviors |
| Geometry workers | Bounded coarse/refined construction, cancellation and transferable buffers |
| Presentation | Seed orb, silhouette, surface reveal and topology-aware replacement |
| Game runtime | Uninterrupted input, movement, physics, scoring and unrelated objects |

## SDK contract first

Implement conceptual tools `get_capabilities`, `reserve_entity`, `apply_geometry_recipe`, `patch_entity`, `inspect_scene`, and `capture_view`, adapting the current operation protocol rather than creating a competing writer. Return entity ID, revision, bounds, mesh statistics, validation warnings and optional selected-view imagery. Avoid returning thousands of vertices to the model.

The recipe vocabulary must include primitives, paths, extrusion, revolution, bounded arbitrary meshes, boolean union/subtraction/intersection, groups, mirroring, arrays, instances, seeded variation and supported deformations. Include colors, roughness, emission, texture references, transforms and parenting. Advertise actual backend capabilities and reject unsupported operations explicitly. General-purpose bevel is not promised; route supported precision rounding to a later CAD backend.

First acceptance object: reserve `arch-1`, subtract a Z-axis cylinder from a centered box, commit the valid mesh, then increase the opening's height by changing only its recipe. Preserve ID, transform, unrelated objects, player position and score. Validate coarse preview, final shape, bounds, undo, replay, reload and baked export. SDK syntax is newly implemented Orbsie functionality, not an existing package API.

## Sequenced implementation

1. **Contract and migration.** Extend current validated geometry/scene operations with recipe source, node IDs, capabilities and revision checks. Reuse reservation, generated-asset persistence and formation paths. Define limits on recipe depth, operations, mesh bytes/triangles, runtime and memory; derive release thresholds from representative measurements.
2. **Backend comparison.** Prototype Bitbybit with only Manifold enabled, behind the SDK. Compare a direct Manifold adapter using the same arch, multipart shape and topology-changing edit. Measure compressed download, initialization, peak memory, build time, cancellation, disposal, integration complexity and resulting mesh correctness. Choose explicitly from evidence. Keep the current renderer and loop; do not scaffold over the app.
3. **Worker integration.** Load expensive kernels after the planet/reservation is visible. Bound queues and start with one active build. Transfer buffers, validate outputs, release WASM resources, terminate/recreate workers when necessary, and reject cancelled/stale revisions. Keep the previous committed object until a replacement validates. Coarse meshes should become recognizable before refinement finishes.
4. **Provider and product milestone.** Run create → targeted edit → play during construction → undo/reload → independent export/publication through OpenRouter and Gateway using permitted Luna test models; ChatGPT subscription connection is now the highest-priority integration per the latest owner clarification. Include explicit new-model requests bypassing the catalog, interrupted jobs, invalid geometry and recovery. Preserve real provider evidence separately from fixtures. Existing simple provider passes do not prove this new SDK flow.
5. **Procedural freedom.** Add a QuickJS-WASM interpreter in a worker for bounded JavaScript that emits recipes or mesh data. Expose only approved geometry functions. Enforce interrupt, memory, result-size and host-operation budgets; verify that network, credentials, storage and arbitrary application APIs are unavailable. Test infinite loops, excessive allocations, oversized geometry and cancellation. A CLI-like `orb model run` can dispatch to the same contract; it is not an OS shell.
6. **Optional precision and Blender evaluation.** Evaluate these after the core browser loop works. Do not make core delivery wait for a native runtime download or experimental browser port.

Astra owns contracts, architecture, every diff review and integration. One Luna xhigh worker implements a bounded task at a time, with concise context and no nested delegation. Regular processing, Fast off. Use targeted validation per change; batch full E2E and live inference at meaningful milestones.

## Optional backend decisions

### Restricted procedural authoring implementation contract

Status: the interpreter foundation (`3ad7a4a`) and editor integration (`b289e7f`) are implemented and reviewed. Production source `c56783c` includes source-size and cloud hash-integrity follow-ups; release evidence is in `docs/evidence/browser-procedural-release/`. Actual worker and editor fixtures pass, but live procedural authoring is not accepted end to end: OpenRouter returned an observed upstream 429, and other provider gates remain open. The interpreter emits existing `BrowserModelRecipe` JSON, including bounded custom mesh nodes. It never receives scene handles, credentials or geometry-kernel objects. The editor retains versioned source, its seed and a host-computed source hash alongside the validated derived recipe. Cloud write admission independently verifies hash consistency without executing source or asserting recipe equivalence. Successful geometry baking precedes committing a replacement; failure retains the previous source, recipe and mesh.

Use a fresh QuickJS runtime per request inside a dedicated authoring worker. Generated JavaScript executes only in the guest interpreter, never through host `eval`, `Function`, module import or injected worker scripts. Expose deterministic seeded helpers and replace guest randomness; remove time access. Do not bridge network, storage, DOM, filesystem, timers, module loading, editor state or account APIs. QuickJS is one layer of isolation, not evidence that an arbitrary worker is safe.

Initial bounds are 32 KiB UTF-8 source, 256 KiB serialized recipe output, 8 MiB guest heap, 512 KiB guest stack and a two-second execution deadline. Run one authoring job at a time with a bounded waiting queue. Guest interruption is supplemented by main-thread worker termination on timeout or cancellation, followed by a fresh worker for later work. Geometry expansion, validation, memory and build deadlines remain independently enforced by the existing modeling worker. Initialization time must be reported separately from guest execution time.

Keep the interpreter and its WASM assets locally served with dependency licenses. Standalone games consume baked geometry and must not load or execute the authoring interpreter. Reload and export use retained recipes/assets without implicitly rerunning source. Provider capability discovery stays off until protocol/store integration and real browser acceptance pass.

Acceptance must prove deterministic output, unavailable host capabilities, loop/recursion/allocation/output limits, malformed-output rejection before geometry work, cancellation followed by a successful job, failed-edit preservation, source/recipe persistence and interpreter-free standalone playback. Follow with live Luna creation and targeted editing at the provider milestone; fixture output does not establish model-authored success.

| Candidate | Role and acceptance condition |
| --- | --- |
| Replicad / OpenCascade.js | Lazy-loaded precision modeling for supported extrusions, cuts, fillets and chamfers; license/dependency review before distribution |
| Babylon.js Node Geometry | Alternative ecosystem reference; retain Three.js unless a separate measured decision justifies migration |
| JSCAD / OpenSCAD-WASM | Optional procedural asset generation behind the same SDK, not the game runtime |
| HeyPuter Blender-WASM | Focused compatibility experiment: Python creates a mesh, required modifiers run, geometry exports/extracts, one Three.js entity updates, then repeats without runtime restart |
| Native Blender companion | Excluded from product delivery; no connection, installation or setup UI. Only already baked historical assets remain compatible. |
| Pyodide | Consider a Python-facing `orbsie` API only after comparative generation-quality/token measurements justify another runtime; do not imply `bpy` compatibility |

For Blender-WASM, inspect the exact chosen commit/build scripts and record browser requirements, cross-origin isolation, startup, download, memory and modifier/export compatibility. The owner's cited 1 GiB initial memory, 4 GiB growth and 32-thread settings are investigation leads, not measured device requirements or accepted production configuration. A working demo alone does not satisfy the editing experiment.

## Rendering, formation and publishing invariants

Reserve before expensive work. Pending formation visuals are separate from committed state. Use correspondence-based morphs only where vertex correspondence is meaningful; boolean/topology changes need a designed target-shape transition. Failure retains the last good geometry. Preserve typing focus and adaptive resolution through updates.

Keep the permissively licensed collection useful, mix reuse with new procedural construction, and honor explicit new-model or backend instructions. Unsupported explicit backend requests report capability honestly.

Bake static assets to validated GLB or equivalent retained mesh assets with materials and provenance. Export the scene and behavior snapshot; the public player must run without editor APIs, provider secrets, authoring interpreters or geometry kernels unless runtime regeneration is explicitly part of the experience. Preserve source recipes in editable projects and required licenses in distributable artifacts.

## Evidence and release gates

Track time to first reservation and recognizable object, refinement time, successful targeted revisions, visual correctness, model token use, cancellation latency, frame-time percentiles, input latency, CPU/RAM and GPU memory where measurable. Record cold/warm kernels, idle versus active construction, hardware/browser and software-rendering limitations. Set budgets before claiming release readiness.

Prove create/edit and cancellation in actual browser workers; prove undo/replay/reload and preservation of unrelated play state; inspect rendered shapes; verify resource cleanup and invalid/stale result rejection. Run desktop/mobile and representative normal-GPU checks. Full provider acceptance includes independently published signed-out play; Gateway funding remains a separate configuration gate. Vercel deployment permissions were repaired and an existing saved game reached READY with signed-out rendering evidence; the new SDK publication workflow still requires its own acceptance.

Do not continue native package/source acquisition for product delivery. Browser worker execution is the modeling acceptance path.

## Primary references

Reviewed entry points; pin versions and recheck exact APIs/licenses during implementation:

- [Three.js documentation](https://threejs.org/docs/) and [ExtrudeGeometry](https://threejs.org/docs/pages/ExtrudeGeometry.html).
- [Manifold](https://github.com/elalish/manifold).
- [Bitbybit Three.js setup](https://learn.bitbybit.dev/learn/npm-packages/threejs/start-with-three-js): documents kernel workers and selective initialization; its example loads assets from a CDN, so production must explicitly decide pinned self-hosted asset delivery. [Repository](https://github.com/bitbybit-dev/bitbybit).
- [QuickJS-WASM integration](https://github.com/justjake/quickjs-emscripten).
- [Blender-WASM](https://github.com/HeyPuter/blender-wasm), [link script](https://raw.githubusercontent.com/HeyPuter/blender-wasm/master/scripts/link_blender_web.sh), [demo deployment configuration](https://raw.githubusercontent.com/HeyPuter/blender-wasm/master/demo/vite.config.js).
- [Replicad](https://replicad.xyz/docs/intro/), [Babylon Node Geometry](https://doc.babylonjs.com/features/featuresDeepDive/mesh/nodeGeometry), [JSCAD](https://github.com/jscad/OpenJSCAD.org), [Pyodide](https://pyodide.org/).
- [Worker APIs](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API), [GLTFExporter](https://threejs.org/docs/pages/GLTFExporter.html), [model function calling](https://developers.openai.com/api/docs/guides/function-calling).

License approval must cover wrappers, kernels, workers, WASM assets and transitive dependencies. Do not infer one uniform license from a wrapper's repository license.

## Initial integration map (historical baseline)

Inspection after the architecture revision identifies these integration boundaries:

- `src/lib/modeling.ts` already validates bounded multipart jobs (including meshes, extrusion and lathe), but has no boolean recipe graph. Introduce a separately versioned browser recipe contract with stable node IDs, explicit output and graph validation; preserve existing version-1 Blender jobs during migration. Do not reinterpret old coordinates or silently treat an unsupported modifier as supported.
- `src/lib/protocol.ts` already persists the modeling job on `generated` geometry and applies `reserve_entity`/`set_geometry` to stable entity IDs. Extend this established protocol for browser recipes rather than adding a second scene-state writer. Existing fixed procedural shapes in `geometry.ts` remain useful previews; they do not satisfy the general SDK requirement.
- `src/lib/generated-models.ts` currently fixes provenance to `source: local-blender` plus `blenderVersion`. Add an explicit browser-backend provenance variant and update save/read/cloud validation together. Never label Manifold output as Blender output. Preserve content hashes, size/bounds validation and old persisted records.
- `src/lib/modeling-connection.ts` is the native-companion transport. It is historical code, not a supported product backend. Current store dispatch must not invoke its pairing or execution flow.
- `src/lib/generated-geometry-queue.ts` and `generated-geometry-core.ts` already handle bounded GLB decoding and formation geometry. Reuse this downstream path for validated baked browser output; add a separate construction worker so decoding and authoring lifecycles are not confused. The existing static player-worker bundling pattern can inform deployment, while baked public players should omit unused authoring kernels.

First bounded implementation task: browser recipe schema, graph validator and focused tests for valid subtraction, targeted node revision, duplicate/missing/cyclic references and resource bounds. Then prototype the kernel adapter against that contract. Capability discovery must not advertise the new backend until actual worker execution and scene integration pass.

## Implementation checkpoint

The recipe graph validator, direct Manifold evaluator, cancellable single-worker queue, GLB baker, and browser provenance variant are implemented. Real Chromium evidence covers worker evaluation, immediate queue cancellation/recovery, GLB persistence/reload and rendered arch inspection. Hard-edge shading was corrected and verified in commit `ce272a8`.

Store/protocol dispatch, provider capability transport, browser worker execution and baked export are integrated. Live OpenRouter Luna creation and targeted geometry editing passed; Gateway BYOK and browser-only ChatGPT subscription generation remain acceptance gates. The general procedural vocabulary, restricted interpreter, representative performance and full provider/publication milestone remain open.

Priority update: AI account/API connection remains the top priority. The browser-only ChatGPT connector is deployed with device challenge issuance/cancellation verified; actual user consent and generation remain pending. Modeling work continues while those account-dependent checks are unavailable.

Extrusion milestone: browser recipes now support simple XY outlines (3–64 distinct vertices), centered along Z, with concave outlines and winding normalization. Invalid intersections/degeneracy are rejected before kernel execution. Real editor create→deepen→reload evidence is in `docs/evidence/browser-extrusion-worker/`; live OpenRouter Luna extrusion creation, material editing, reload and standalone playback passed in `docs/evidence/provider-e2e/browser-extrusion-output-contract/`. This does not prove a live geometry-depth edit or publication. Standalone source dependency closure now follows actual build inputs and passes an isolated rebuild check.

Revolution milestone: full Y-axis revolutions of bounded simple radius/height polygons are implemented. Negative radii and invalid polygons are rejected before execution; profile heights remain explicit. Actual Manifold tests verify winding equivalence and Y-up bounds. Real editor/worker create→widen→reload→baked export→standalone rendering passed with synthetic provider responses, with no external requests. See `docs/evidence/browser-revolution-worker/`. Live OpenRouter Luna revolve creation and radius-only geometry editing also passed (`docs/evidence/provider-e2e/browser-revolution-openrouter/`), preserving explicit Y bounds and unrelated state. Partial sweeps, restricted procedural scripts, and the other general-vocabulary requirements remain open.


Custom mesh milestone (deployed source `cfa9901`): recipes accept strict nodes `{id,kind:"mesh",vertices:[[x,y,z],...],triangles:[[a,b,c],...]}`. Per node: 4–4096 vertices and 4–8192 triangles; per recipe: 8192 vertices and 16384 triangles. Coordinates are normalized to Float32 before geometric validation. A node must form one connected, outward closed shell with referenced unique vertices and nondegenerate, consistently oriented triangles. Compound solids use separate graph nodes.

The worker checks geometric intersections beyond shared features, including coplanar overlaps. Positional tolerance is 1e-6 meters; features at that tolerance and dense broadphase workloads may be conservatively rejected. Broadphase work is capped at 500,000 grid assignments, 250,000 unique candidate pairs and 500,000 total pair visits. Tests specifically distinguish budget exhaustion from geometric rejection, and demonstrate a connected positive-volume self-intersection accepted by raw Manifold but rejected by Orbsie. Model-facing failures remain generic; no arbitrary code, URLs or raw kernel properties are accepted.

Real editor/worker fixtures prove pyramid creation, height editing, rejected inversion preserving the last finished object, reload and exact-GLB standalone export (`docs/evidence/browser-mesh-worker/`). These tests do not prove live model-authored mesh quality or performance targets. One standalone start exceeded five seconds; a measured retry took 3518 ms. Subsequent tube and composition milestones below cover bounded paths, mirroring, arrays and baked instances. Seeded deformation, the restricted procedural interpreter and the full provider/gameplay acceptance matrix remain open.

Capped tube milestone (deployed source `1d08574`): strict `tube` nodes accept `path` (2–63 unique 3D points), `radius` (>0.0001 and ≤50 meters), and `segments` (3–64, default16). Deterministic parallel-transport frames build a closed solid with planar caps at the open path endpoints. Path and generated coordinates stay within ±100 meters; derived tube vertices/triangles count toward the shared recipe mesh budget. The existing geometric validator rejects self-overlap, degeneracy and exhausted work budgets before Manifold construction. Closed loops, variable radius, twist controls and custom sweep profiles remain unsupported.

Fixture editor create→radius edit→failed reversal preserving last good object→reload→exact GLB export→standalone passed in `docs/evidence/browser-tube-worker/`. The production build passes. This is a bounded path capability, not completion of all composition/deformation or procedural-code requirements.

Composition milestone (deployed source `71134b4`): strict `compose` nodes join 2–32 separated inputs; `mirror` reflects an input through the origin plane defined by a nonzero normal; `linear-array` makes 2–32 copies at `i * offset`; `instances` accepts 1–32 explicit positive-scale XYZ transforms. Output is one baked mesh. These operations do not implement scene parenting, independent child entity IDs/materials, or GPU instancing.

Expanded geometry leaves are capped at64 per output, including nested/shared graph references. Actual child geometry is checked before copying, transformed output remains within ±100 meters, and separation checks are bounded across the recipe. Touching, intersecting and fully nested solids are rejected; intentional merging uses boolean union. Browser fixture evidence for all four operations, targeted spacing edits, exact undo/redo, failed overlap preservation and twelve-copy export is in `docs/evidence/browser-composition-worker/`. Full provider authoring remains unverified for these operations.
