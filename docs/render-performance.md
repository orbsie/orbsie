# Rendering performance

The renderer now adjusts its backing resolution after sustained slow frames and batches the 45 shoreline pebbles into one instanced mesh. World geometry, formation timing, materials, lighting, shadow-map resolution, camera behavior, and gameplay rules remain unchanged. No live model calls were made.

## Changes

- Normal resolution stays at native DPR up to 1.5, with a 2.5-million-pixel backing-buffer cap on large screens. Two slow two-second windows reduce DPR by 0.25, normally down to 0.75. If the large-screen cap is already below 0.75, it remains the lower bound. Six fast windows permit a gradual recovery. Startup, hidden tabs, and long suspended-frame gaps do not count as sustained rendering load.
- All 45 pebbles retain their geometry, transforms, and colors but share a single instanced draw instead of 45 individual draws. React Three Fiber owns/disposes their declarative geometry/material/mesh.
- Reuse entity target/scale vectors, player direction/up vectors, and transition camera vectors. Cache the media-query object while still reading its current reduced-motion preference each frame.
- Dispose the memoized planet geometry on unmount. Existing formation geometry/material disposal remains intact.
- Add fixture-only `scripts/measure-render.mjs` plus six focused budget tests. No edits to geometry generation or gameplay logic were needed.

## Measurement

One before and one after run used the same Chromium 153 headless SwiftShader renderer, 1440×1000 viewport, device DPR 1, video recording, fixed 14-entity island fixture, shared playback, 18-second warmup, and 240 requestAnimationFrame intervals. Creation/generation requests were blocked. Baseline was root dev server port 3001; after was isolated Next webpack dev server port 3007.

| | Before | After |
|---|---:|---:|
| Median frame interval | 66.7 ms | 50.0 ms |
| p95 frame interval | 100.1 ms | 83.4 ms |
| Backing canvas | 1440×1000 | 1080×750 |
| Browser page errors | 0 | 0 |

Median interval fell about 25%, and p95 about 17%. This is approximately 15 to 20 fps in the software-rendered recording; it is **not a 60-fps result or a hardware-GPU certification**. The lower backing resolution deliberately trades some sharpness for responsiveness; triangles, objects, and shadow detail remain present. Both screenshots were inspected and show the same island design and shoreline geometry. Moving platforms/crystals are naturally captured at different animation times.

The host also ran other development tasks. Another agent closed its browser and paused additional browser work during the latter portion of the after run. The development servers use different bundlers, and these are single samples rather than a statistically controlled benchmark. A follow-up on native desktop/mobile GPUs should measure production output, repeated runs, and input latency. The test measures frame scheduling, not isolated GPU render duration.

Raw evidence is available in `/tmp/orbsie-render-before/report.json`, `/tmp/orbsie-render-after/report.json`, and the corresponding `playback.png`/recording files. Reproduce with:

```sh
TEST_URL=http://localhost:3001 PERF_OUTPUT=/tmp/orbsie-render-before node scripts/measure-render.mjs
TEST_URL=http://localhost:3007 PERF_OUTPUT=/tmp/orbsie-render-after node scripts/measure-render.mjs
```

## Validation and integration

- `npm run typecheck` passed.
- `npx vitest run tests/render-budget.test.ts tests/gameplay.test.ts`: 15 tests passed.
- Before/after fixture playback had no page errors and used no generation calls.
- The standalone source allowlist now includes `src/lib/render-budget.ts`; root must regenerate the player runtime/source artifacts during integration.
- Webpack's generated `next-env.d.ts` development-path change is local server output and is restored before commit. The worktree's local `node_modules` symlink is not an artifact to ship.
