# Local Blender runtime probe

## Bundled application component

`node scripts/package-modeling-companion.mjs OUTPUT_DIRECTORY` builds the foreground launcher, trusted modeling code, Python job and application/Zod licenses into a new directory. It refuses an existing destination. Execution uses `node companion.mjs`; no repository checkout, npm install or startup bundling is required. Put the verified Blender package in `runtime` beside the launcher, or set `ORBSIE_BLENDER_RUNTIME_DIR` explicitly. An unset or empty setting uses that bundled path and never silently selects system Blender.

`node companion.mjs --check` performs a real isolated box construction and GLB validation, prints bounded readiness/timing/size data and exits without opening a connection. `--help` needs no Blender. Normal startup performs the same preflight before showing a private browser connection link; Ctrl+C revokes the foreground connection.

Local validation on 2026-09-08: the bundled application successfully ran `--check` with the existing official 4.0.2 runtime prototype (1,884-byte GLB; initial measured preflight 806 ms). Missing-runtime startup failed without a system fallback. This is application packaging evidence only: the output does not contain Blender or Node, the tested runtime remains nonportable, and complete installer, source/license distribution and supported-platform validation remain release gates.

This document records the first local companion capability check for Orbsie. It
is a foundation probe only. It does not ship a companion, execute model output,
or establish that a local Blender workflow is ready for production.

## Measured Linux probe

Run it from the repository with:

```sh
node scripts/blender-probe.mjs --output /tmp/orbsie-blender-probe-verified.glb
```

The probe ran on 2026-09-07 in this workspace with the following result:

| Measurement                    | Result                                                                  |
| ------------------------------ | ----------------------------------------------------------------------- |
| Platform                       | Linux x86_64                                                            |
| Blender                        | 4.0.2 (`/usr/bin/blender`)                                              |
| Bubblewrap                     | 0.12.0 (`/usr/bin/bwrap`)                                               |
| Probe wall time                | 1,292 ms                                                                |
| GLB size                       | 11,256 bytes                                                            |
| GLB format                     | glTF 2 / GLB, header length matched file length                         |
| GLB JSON chunk                 | 2,228 bytes                                                             |
| GLB meshes / materials / nodes | 2 / 2 / 2                                                               |
| Procedural geometry            | 42-vertex icosphere (80 triangles) and 8-vertex platform (12 triangles) |

The output file was written with mode `0600` and independently checked by the
Node probe: the `glTF` magic, version 2 header, declared file length, first JSON
chunk, and `asset.version = "2.0"` all validated. The elapsed value is a single
local run, including process startup and GLB export, on a warm development
machine; it is not an installation or cold-cache benchmark.

The trusted Blender job also emitted per-object semantic IDs, material names,
triangle and vertex counts, and world-space bounds. These are the fields a
future companion can feed into reservation and formation validation. A
thumbnail, collider, and provenance manifest are intentionally not fabricated
by this probe.

## Isolation boundary exercised

`scripts/blender-probe.mjs` writes a repository-owned Python program to a
temporary job directory and invokes it through:

- `bubblewrap --unshare-all --clearenv --die-with-parent --new-session`, which
  leaves the job without a network namespace interface and isolates user, PID,
  mount, IPC, UTS, and related namespaces;
- read-only mounts for `/usr`, `/bin`, `/lib`, `/lib64`, the dynamic-loader
  cache, `/etc/alternatives`, and the small non-secret `/etc` identity files
  Blender needs;
- a read-only mount of the exact NumPy package used by this Debian Blender
  install, because its GLB exporter imports NumPy;
- a temporary writable `/work` bind for the job script, intermediate GLB, and
  metadata; `/tmp` and `/home` are private temporary filesystems;
- `--factory-startup --disable-autoexec`, with no normal Blender user
  configuration or addon path mounted;
- `/usr/bin/timeout` at 30 seconds, `RLIMIT_CPU=20` seconds,
  `RLIMIT_AS=2 GiB`, `RLIMIT_FSIZE=64 MiB`, and `RLIMIT_NPROC=4096`.

The 2 GiB address-space limit is deliberate. A 1 GiB limit caused Blender's
jemalloc startup to fail inside this namespace; 2 GiB was the smallest tested
limit that completed the probe. Likewise, `RLIMIT_NPROC` values of 512, 1,024,
and 2,048 prevented bubblewrap from creating its namespace in this workspace's
large shared user session; 4,096 started reliably. A production companion
should measure and enforce a per-job cgroup/process budget rather than assuming
these development-host values are portable.

The system package exposes Blender's Python through Python 3.12 and the GLB
exporter imports NumPy 2.5.0 from the current user's site-packages. The probe
mounts only `numpy` and `numpy.libs` read-only; it does not mount the user's
home, project tree, credentials, or arbitrary site-packages. A distributed
companion must bundle a version-pinned Blender Python dependency set instead of
depending on a user's site-packages directory.

The current scope is Linux x86_64 with bubblewrap and a Blender installation
laid out like this Debian package. There is no evidence yet for Windows,
macOS, ARM, GPU rendering, restart behavior, cancellation recovery, or an
installed companion. Those platforms and capabilities must not be presented as
supported until separately tested.

## Trusted job and future typed protocol

The probe does not accept Python, Blender files, URLs, or model text. Its static
job creates two tiny procedural meshes and exports them through Blender's glTF
exporter. Future LLM-driven modeling should preserve that boundary:

1. The provider adapter emits a complete, schema-validated modeling plan. It
   never emits executable Python to the browser or directly to Blender.
2. Trusted companion code translates the plan into a bounded Blender program
   or into a small set of trusted Blender API calls. The generated program is
   run in the same isolated job boundary as this probe, with no access to
   credentials, arbitrary host paths, or the network.
3. The job returns a typed artifact envelope, for example:

   ```json
   {
     "protocolVersion": "orbsie.modeling-job.v1",
     "jobId": "job_...",
     "projectId": "orb_...",
     "runId": "run_...",
     "baseRevision": 12,
     "entityId": "entity_...",
     "status": "ready",
     "glb": { "path": "result/model.glb", "sha256": "...", "bytes": 0 },
     "bounds": { "min": [0, 0, 0], "max": [0, 0, 0] },
     "materials": [{ "name": "...", "baseColor": [1, 1, 1, 1] }],
     "thumbnail": { "path": "result/thumbnail.webp", "sha256": "..." },
     "provenance": { "source": "generated", "seed": "..." }
   }
   ```

   The real schema should use the project's typed validation library and carry
   operation IDs, expected base revision, stage progress, limits, and failure
   diagnostics. Paths are job-relative and are resolved only inside the job
   directory.

4. Trusted validation checks GLB structure, file size, mesh counts, finite
   bounds, material references, texture limits, and the requested stable entity
   ID before publishing the result to the reservation/formation/revision
   pipeline. Unknown catalog IDs and remote URLs remain invalid.
5. The client persists the accepted GLB and metadata with its revision. A
   standalone export or publication must include the GLB, thumbnail, and
   generated-art provenance; it must not depend on a running editor or Blender.

Suggested job stages are `queued`, `building`, `validating`, `exporting`,
`ready`, `cancelled`, and `failed`. Each stage should report bounded progress,
allow cancellation, and leave the last committed scene intact on failure.
Generation and geometry refinement should remain separate from the editor's
render loop so a local job cannot freeze play or selection.

## Packaging and licensing work still required

A shippable optional companion needs a reproducible distribution step:

1. Pin the exact Blender release and platform artifact, record its SHA-256,
   and verify it before installation. The current probe observed 4.0.2 only; it
   is not a release pin or a claim that this binary can be redistributed.
2. Bundle only after the modeling/export acceptance suite identifies the needed
   Blender data, Python modules, exporter addon, and native libraries. Measure
   archive size, installed size, first launch, peak memory, and restart time on
   every declared platform before calling the distribution minimal.
3. Include Blender's GPL notices, the corresponding source and build
   instructions or source offer required for the shipped binary, and dependency
   license notices. Track generated artwork provenance separately from the
   Blender software license.
4. Keep the native companion outside the browser bundle. The browser should
   use an explicit capability handshake with the companion and show an honest
   unavailable state when it is absent. A browser page must never assume it can
   execute a native Blender binary.
5. Add installation, restart, cancellation, failure recovery, isolation, and
   editor-responsiveness checks before enabling the capability for real users.

The Blender license and distribution guidance are published at
[blender.org/about/license](https://www.blender.org/about/license/). Blender's
headless command-line behavior is documented in the
[official command-line rendering manual](https://docs.blender.org/manual/en/latest/advanced/command_line/render.html).

## Running and interpreting the probe

Use `--keep-workdir` when diagnosing a failed job; it preserves the temporary
job script and intermediate files under `/tmp`. `ORBSIE_BLENDER_PATH`,
`ORBSIE_BWRAP_PATH`, and `ORBSIE_BLENDER_NUMPY_PATH` can point at a compatible
local installation for investigation, but the current mount layout remains
Linux/Debian-specific. A successful result proves only that this trusted tiny
procedural mesh can be exported to a structurally valid GLB in the measured
namespace. It does not prove arbitrary model plans, generated Python, GPU
rendering, or an LLM-to-Blender-to-browser round trip.

Root independently reran the probe successfully in 1,299 ms with the same 11,256-byte GLB. The reported object bounds are Blender Z-up coordinates; future runtime integration must convert them to glTF/Orbsie Y-up or recompute bounds from the exported GLB. The probe uses the tested `/usr/bin/blender` package; arbitrary binary-path overrides are not supported.

## Typed modeling implementation

`scripts/blender-modeling.ts` translates validated `src/lib/modeling.ts` jobs
through a fixed Python program in the isolated Linux runtime. Supported parts
are boxes, spheres, cylinders, cones, tori, custom polygon meshes, profile
extrusions and surfaces of revolution. Job coordinates are Y-up; the executor
converts to Blender coordinates and exports Y-up GLB results. Input budgets,
process limits, cancellation and output validation apply before results can be
accepted by the editor.

For the packaged-runtime prototype, set `ORBSIE_BLENDER_RUNTIME_DIR` to the
root produced by `scripts/package-blender-runtime.mjs`, for example
`/tmp/orbsie-blender-runtime-official-4.0.2`. The runner verifies the
`orbsie.blender-runtime/v1` manifest, official-release provenance and pinned
4.0.2 archive digest, executable SHA-256, executable capability fields, bundled
Python and NumPy paths, clean-environment probe, and bundled GPL notice before
starting a job. Bubblewrap mounts that root read-only at
`/opt/orbsie-blender-runtime`, selects its `share/blender/python` and native
`lib` directories explicitly, and does not use the host NumPy path. The
system-install path remains the default when this variable is unset.

The manifest check establishes consistency with the package metadata generated
by the local packaging probe; it is not a signature, full extracted-tree
measurement, or a supply-chain trust anchor. The executable digest is checked,
but the manifest, resource files, native libraries and license files remain
mutable local files under the configured runtime directory. The current
package still depends on host glibc, X11 and related Linux libraries, and its
1.6 GiB prototype footprint is not a minimal distribution.
The package includes Blender license notices and records the official source,
release index, license and build links. A future distributable companion must
reproduce the package from a pinned source artifact, publish the corresponding
source/build offer required by Blender's GPL terms, audit every bundled
dependency license, and run this check on each supported platform.

`src/lib/generated-glb.ts` checks the static, untextured triangle subset before
loading: complete chunks, internal buffer ranges, accessor allocation budgets,
indices, node graphs and unsupported resource/extension rejection.
`src/lib/generated-models.ts` provides content-addressed IndexedDB persistence,
verifies saved bytes on read and preserves the first provenance record. Bounds
and engine version come from the trusted executor; this storage API is not an
untrusted upload endpoint.

The provider-neutral HTTP boundary (`scripts/modeling-companion.ts`) and browser
client (`src/lib/modeling-connection.ts`) now connect modeling to local storage.
The private capability stays in memory and is sent only to the exact loopback
origin. Jobs stream bounded progress, allow cancellation and reject concurrent
requests; shutdown waits for the isolated job's cleanup.

`node scripts/verify-local-modeling.mjs` is a developer verification command
against the local app on port 3017. It performs real Blender construction,
browser GLB loading/rendering, exact bounds comparison and IndexedDB recovery
after reload. `docs/evidence/local-modeling/report.json` records the result;
this probe performs no LLM inference and does not exercise the Orbsie editor.

`node scripts/run-modeling-companion.mjs` starts the development companion after
an actual tiny Blender preflight; `ORBSIE_ORIGIN` chooses its one allowed origin.
The emitted builder capability link connects the editor after a health check;
it can also be pasted under Connections without replacing an existing ChatGPT
connection. Keep it private and stop the foreground process to revoke access.
No credentials or subscription connection are needed
for local geometry construction.

The editor now awaits validated local construction before applying generated
geometry. Scoped recolors preserve the geometry and identity; standalone ZIPs
include generated GLBs, provenance and source. The real Astra-low creation,
scoped edit, reload and standalone export flow passed in
`docs/evidence/provider-e2e/blender/chatgpt-local.json`. This run used no catalog
models and made two actual ChatGPT generation requests. Cloud asset storage,
dedicated publication, the remaining provider matrix, portable installation
and measured responsiveness remain open gates.
