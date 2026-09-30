# Native-GPU desktop frame timing — 2026-09-29

First Orbsie frame-time sample on a physical GPU instead of SwiftShader.

- Command: `PERF_GPU=native PERF_RECORD_VIDEO=0 PERF_SAMPLES=600
  ORBSIE_BUILD_MODE=production node scripts/measure-render.mjs` against the
  loopback production build of `7878056` (source identical to `33850b2`).
- Renderer: `ANGLE (NVIDIA, Vulkan 1.4.329 (NVIDIA Quadro RTX 8000))`, headed
  Chromium on X display `:20` (1600×1200 at 60 Hz, a virtual remote-desktop
  display), 1440×1000 viewport, DPR 1, full 1440×1000 backing canvas.
- Host: AMD EPYC 9124, 32 logical CPUs, ~64 GiB RAM; load average about 41
  during the run from unrelated work.
- Scene: fixed 14-entity island fixture in the published player; no
  generation requests, no page errors.

| Page | Median | p95 | p99 | Frames at one vsync |
|---|---:|---:|---:|---:|
| Orbsie 14-entity fixture | 16.7 ms | 33.4 ms | 50.0 ms | 65.5% |
| Empty WebGL clear-only page, same browser setup | 16.7 ms | 33.4 ms | 50.0 ms | 71.3% |

The median meets 60 fps on this GPU. The tail matches the empty-page baseline,
so most missed vsyncs come from the loaded host and virtual display rather
than Orbsie rendering; the fixture adds about six points of missed frames.
Frame intervals include display presentation and are not isolated GPU time.
This closes a desktop native-GPU observation only; it is not a normal-laptop,
larger-scene, or mobile certification.
