# Packaged launcher lifecycle

`lifecycle.json` records real local startup and restart using the application bundle with full-tree runtime integrity validation and the rebuilt official Blender 4.0.2 packaging prototype. Launcher and runtime-manifest SHA-256 values identify the exact artifacts.

The harness runs the launcher with an empty working directory and a small explicit environment, waits for an actual isolated Blender preflight, checks authenticated health and invalid-token rejection, shuts down with SIGTERM, and repeats startup. The previous capability is rejected by the restarted process. Capability links and tokens remain in memory and are never written to the report. Both starts passed in approximately 2.3 seconds with full-tree hashing (the earlier executable-only check took approximately 0.9 seconds). These warm local timings do not measure clean installation or cold-cache performance.

Reproduce after building the application component:

```sh
ORBSIE_BLENDER_RUNTIME_DIR=/path/to/verified-runtime node scripts/verify-packaged-companion.mjs /path/to/application/companion.mjs
```

No inference, cloud account changes, or external messages occur. This evidence does not prove a portable installer, bundled Node, distribution license completeness or cross-platform support.
