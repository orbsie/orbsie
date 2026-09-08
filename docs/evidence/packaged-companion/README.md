# Packaged launcher lifecycle

`lifecycle.json` records real local startup and restart using the application bundle with full-tree runtime integrity validation and the rebuilt official Blender 4.0.2 packaging prototype. The latest run moved the application/runtime to a different directory and resolved `runtime` beside the launcher without an environment override. Launcher and runtime-manifest SHA-256 values identify the exact artifacts.

The harness runs the launcher with an empty working directory and a small explicit environment, waits for an actual isolated Blender preflight, checks authenticated health and invalid-token rejection, shuts down with SIGTERM, and repeats startup. The previous capability is rejected by the restarted process. Capability links and tokens remain in memory and are never written to the report. Both relocated starts passed in approximately 1.9 seconds with full-tree hashing (the larger preceding package took approximately 2.3 seconds; the earlier executable-only check took approximately 0.9 seconds). These warm local timings do not measure clean installation or cold-cache performance.

`relocation.json` records the rebuilt package at 1,322,667,283 bytes versus the preceding 1,698,770,208-byte measurement, approximately 22% smaller. The archive copier preserves and relocates contained library symlinks instead of materializing duplicate files. The newer packager also removes transient verification files, so the total delta includes that cleanup. All 15 runtime/modeling tests passed against the relocated runtime; seven focused archive-copy tests passed separately. No runtime features were pruned in this step.

Reproduce after building the application component:

```sh
ORBSIE_BLENDER_RUNTIME_DIR=/path/to/verified-runtime node scripts/verify-packaged-companion.mjs /path/to/application/companion.mjs
```

Omit `ORBSIE_BLENDER_RUNTIME_DIR` to verify the runtime packaged beside the launcher.

No inference, cloud account changes, or external messages occur. This evidence does not prove a portable installer, bundled Node, distribution license completeness or cross-platform support.
