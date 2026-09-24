# Current standalone player on Android — September 23, 2026

The source world is the previously generated OpenRouter standalone ZIP at
`docs/evidence/provider-e2e/openrouter-post-residency/openrouter/world.zip`.
Its project snapshot was served locally with the current `public/player`
runtime files. This repackaging tests the current player; it does not imply a
fresh export or publication. Android 15 midrange-emulator Chrome opened the
local server through `adb reverse`. WebGL contexts were forced unavailable to
exercise compatibility graphics. The browser was blocked from making external
requests, and no model calls were made.

The opt-in gameplay observation readout recorded a 2.79-unit player movement
during a 700 ms Forward touch. Movement was zero during the second 500 ms
after release. A 120 ms Jump touch raised the player 0.65 units. The only page
error was Three.js reporting its expected failed WebGL-context creation.
See [report.json](report.json) for the exact measurements.

The initial portrait screenshot showed the compatibility notice covering the
title and score. The current CSS moves the notice below the score in portrait.
In a 866×308 landscape viewport, it sits above the touch controls and the
redundant footer is hidden. DOM rectangle checks found no overlap with the
header, score, or controls. The existing `verify-player-touch-layout.mjs`
fixture passed portrait and landscape input, restart, win/loss, and synthetic
safe-area cases against the rebuilt runtime. Compare the [portrait before](standalone-android-software-portrait.png),
[portrait after](standalone-android-software-portrait-fixed.png), and
[landscape after](standalone-android-software-landscape-fixed.png) captures.

Physical-device performance, native WebGL compositing on this emulator, a
fresh provider export, and public deployment remain unverified.
