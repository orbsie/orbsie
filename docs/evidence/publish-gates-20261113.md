# Locally provable publish gates — 2026-11-13/14

All runs used the production build (`npm run build` + `npm start`) at
`http://127.0.0.1:3048`, Chromium 153 with SwiftShader, 16 hardware threads.
Zero provider calls. Software rendering means no frame-rate, latency or
device claim transfers to real hardware.

| Gate | Result | Evidence |
| --- | --- | --- |
| OpenRouter OAuth UI/draft/races (synthetic) | passed | `openrouter-oauth-synthetic-20261113/` |
| Catalog audit + three-mode comparison | passed | `catalog-comparison-20261113/`, `verify-catalog-assets.mjs` |
| Composer continuity (keyboard Enter) | passed, 11/11 checks | `composer-continuity-20261113/report.json` |
| Input feedback (submit → workspace/user message/building) | passed; DOM 133.3 ms, next frame 1105.8 ms — both **miss the 100 ms goal on this host** | `input-feedback-20261113/report.json` |
| Input consumption latency (simulation boundary) | passed; 2 samples, p50 1 ms, p95 510 ms — sample size too small to characterise | `input-latency-20261113/report.json` |
| Render frame intervals (14-entity fixture) | median 133.3 ms, p95 249.9 ms, p99 366.7 ms under SwiftShader — **not native-GPU evidence** | `render-performance-20261113/report.json` |
| Far-world persistence | WebGL lane 11/11 passed incl. standalone; forced-Canvas2D lane failed on a screenshot timeout | `far-world-browser/current-20261113/` |
| World navigation | mobile touch lane passed; desktop WebGL failed the marker pixel threshold (39 < 100), desktop Canvas2D failed on a screenshot timeout | `world-navigation-browser/current-20261113/` |
| Play during stream | **passed, 15/15 checks** after fixture repair: play entered before commit, ArrowRight scores 7 while building, material update reaches the app before EOF with score and play preserved, commit/EOF, ArrowUp wins; persisted color and tint are `#5d8cff` | `play-during-stream-20261113/report.json` |

## Harness defects repaired in this pass

1. Locator expectations in `verify-input-feedback`, `verify-input-latency`,
   `verify-touch-input-lifecycle`, `verify-world-navigation-browser` and
   `verify-far-world-persistence` used Playwright's 5 s default while their
   pages allowed 15–30 s, so slow hydration looked like missing elements.
2. Four release scripts still selected `.building-message`, a class the
   flattened activity-message redesign removed. They now use the real
   in-progress indicator, `.authoring-activity-message .pulse-orb`; the
   composer-continuity and input-feedback gates pass with that selector.
3. Screenshots from a software-rendered canvas need a 60 s budget; the
   far-world standalone player also needs its own browser so a long editor
   journey cannot exhaust WebGL contexts.

## Fixture staleness resolved

`play-during-stream` first failed because it read mid-stream scene state from
IndexedDB. The app intentionally persists only at `commit_revision`, so that
assertion could never hold on the current build. Readiness is now observed as
the refined crystal appearing in the canvas, the material update as its
activity entry, and the material result from the committed project. With those
changes the fixture passes 15/15; the September claim was not a product
regression.

## Open risks surfaced
- The world-navigation desktop lanes and the forced-Canvas2D far-world lane do
  not complete on this host; treat the mobile touch lane and the WebGL
  far-world lane as the only current navigation evidence.
