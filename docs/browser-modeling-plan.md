# Browser-first modeling delivery plan

Owner direction incorporated September 2026. This is an implementation plan, not a completion report. `prompt.md` remains the overall product contract. Existing native Blender prototypes are optional-backend evidence only.

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
4. **Provider and product milestone.** Run create → targeted edit → play during construction → undo/reload → independent export/publication through OpenRouter, Gateway and ChatGPT using permitted Luna test models. Include explicit new-model requests bypassing the catalog, interrupted jobs, invalid geometry and recovery. Preserve real provider evidence separately from fixtures. Existing simple provider passes do not prove this new SDK flow.
5. **Procedural freedom.** Add a QuickJS-WASM interpreter in a worker for bounded JavaScript that emits recipes or mesh data. Expose only approved geometry functions. Enforce interrupt, memory, result-size and host-operation budgets; verify that network, credentials, storage and arbitrary application APIs are unavailable. Test infinite loops, excessive allocations, oversized geometry and cancellation. A CLI-like `orb model run` can dispatch to the same contract; it is not an OS shell.
6. **Optional precision and Blender evaluation.** Evaluate these after the core browser loop works. Do not make core delivery wait for a native runtime download or experimental browser port.

Astra owns contracts, architecture, every diff review and integration. One Luna xhigh worker implements a bounded task at a time, with concise context and no nested delegation. Regular processing, Fast off. Use targeted validation per change; batch full E2E and live inference at meaningful milestones.

## Optional backend decisions

| Candidate | Role and acceptance condition |
| --- | --- |
| Replicad / OpenCascade.js | Lazy-loaded precision modeling for supported extrusions, cuts, fillets and chamfers; license/dependency review before distribution |
| Babylon.js Node Geometry | Alternative ecosystem reference; retain Three.js unless a separate measured decision justifies migration |
| JSCAD / OpenSCAD-WASM | Optional procedural asset generation behind the same SDK, not the game runtime |
| HeyPuter Blender-WASM | Focused compatibility experiment: Python creates a mesh, required modifiers run, geometry exports/extracts, one Three.js entity updates, then repeats without runtime restart |
| Native Blender companion | Optional advanced backend; preserve existing isolation, pinned packaging, clean-machine, license/source and restart gates before shipping |
| Pyodide | Consider a Python-facing `orbsie` API only after comparative generation-quality/token measurements justify another runtime; do not imply `bpy` compatibility |

For Blender-WASM, inspect the exact chosen commit/build scripts and record browser requirements, cross-origin isolation, startup, download, memory and modifier/export compatibility. The owner's cited 1 GiB initial memory, 4 GiB growth and 32-thread settings are investigation leads, not measured device requirements or accepted production configuration. A working demo alone does not satisfy the editing experiment.

## Rendering, formation and publishing invariants

Reserve before expensive work. Pending formation visuals are separate from committed state. Use correspondence-based morphs only where vertex correspondence is meaningful; boolean/topology changes need a designed target-shape transition. Failure retains the last good geometry. Preserve typing focus and adaptive resolution through updates.

Keep the permissively licensed collection useful, mix reuse with new procedural construction, and honor explicit new-model or backend instructions. Unsupported explicit backend requests report capability honestly.

Bake static assets to validated GLB or equivalent retained mesh assets with materials and provenance. Export the scene and behavior snapshot; the public player must run without editor APIs, provider secrets, authoring interpreters or geometry kernels unless runtime regeneration is explicitly part of the experience. Preserve source recipes in editable projects and required licenses in distributable artifacts.

## Evidence and release gates

Track time to first reservation and recognizable object, refinement time, successful targeted revisions, visual correctness, model token use, cancellation latency, frame-time percentiles, input latency, CPU/RAM and GPU memory where measurable. Record cold/warm kernels, idle versus active construction, hardware/browser and software-rendering limitations. Set budgets before claiming release readiness.

Prove create/edit and cancellation in actual browser workers; prove undo/replay/reload and preservation of unrelated play state; inspect rendered shapes; verify resource cleanup and invalid/stale result rejection. Run desktop/mobile and representative normal-GPU checks. Full provider acceptance includes independently published signed-out play; Gateway funding remains a separate configuration gate. Vercel deployment permissions were repaired and an existing saved game reached READY with signed-out rendering evidence; the new SDK publication workflow still requires its own acceptance.

The native package/source acquisition already underway may finish as reusable optional-backend work. It must not delay the SDK prototype, imply native delivery is complete, or substitute for browser modeling tests.

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
- `src/lib/modeling-connection.ts` is the native-companion transport. Keep it as a backend adapter; browser construction must not require its pairing flow. Integrate backend selection at the existing store/job boundary, with capability checks and explicit requested-backend handling.
- `src/lib/generated-geometry-queue.ts` and `generated-geometry-core.ts` already handle bounded GLB decoding and formation geometry. Reuse this downstream path for validated baked browser output; add a separate construction worker so decoding and authoring lifecycles are not confused. The existing static player-worker bundling pattern can inform deployment, while baked public players should omit unused authoring kernels.

First bounded implementation task: browser recipe schema, graph validator and focused tests for valid subtraction, targeted node revision, duplicate/missing/cyclic references and resource bounds. Then prototype the kernel adapter against that contract. Capability discovery must not advertise the new backend until actual worker execution and scene integration pass.

## Implementation checkpoint

The recipe graph validator, direct Manifold evaluator, cancellable single-worker queue, GLB baker, and browser provenance variant are implemented. Real Chromium evidence covers worker evaluation, immediate queue cancellation/recovery, GLB persistence/reload and rendered arch inspection. Hard-edge shading was corrected and verified in commit `ce272a8`.

Store/protocol dispatch is under review. Provider prompts and request capabilities have not yet been connected, so browser modeling is not advertised as an accepted end-to-end feature. Next gate: complete store cancellation/provenance tests, connect capability transport consistently across OpenRouter/Gateway/ChatGPT, then exercise the real editor before live-provider acceptance. The general procedural vocabulary, restricted interpreter, representative performance and full provider/publication milestone remain open.
