# Android touch-hold regression — 2026-09-23

Android 15 `sdk_gphone64_x86_64` emulator, Chrome, 1080×2400, 4 GiB RAM.
The exported OpenRouter test world from `openrouter-post-residency` was served
through `adb reverse` on loopback, with no model or external network calls.

The original immutable ZIP was served unchanged for the baseline. A 700 ms
hold on the right movement button moved the world, but Chrome opened a text
selection toolbar on the button ([before](before-selection-toolbar.png)).
The candidate was a separate temporary extraction of that ZIP with only its
`runtime.css` replaced by the freshly built `src/player/player.css` output.
The same hold moved the world and did not open text selection
([before hold](candidate-before.png), [after hold](candidate-after-hold.png)).

The source fix adds `user-select: none`, `-webkit-user-select: none`, and
`-webkit-touch-callout: none` to standalone and editor touch buttons. The
targeted `scripts/verify-player-touch-layout.mjs` portrait/landscape and
synthetic safe-area checks passed after rebuilding the player. The candidate
test does not retroactively validate the old ZIP, a new publication, a
physical Android device, or iOS Safari.
