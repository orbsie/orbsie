# Android Chrome layout check — 2026-09-22

Environment: Android 15 emulator `droidlm_api35_midrange`, 1080 × 2400 at 420 dpi, Chrome, software graphics renderer. Opened live `https://orbsie.com` after Chrome first-run setup. Optional Chrome usage/crash reporting was disabled; Chrome continued without a Google account and notifications were declined, per owner authorization.

Observed: the home page rendered with planet, prompt composer, provider/free-prompt control, and Create button in portrait and landscape. The Connections dialog opened from the home page. Its ChatGPT, free-prompt, OpenRouter, and Quality/Balanced/Budget controls were visible in portrait after scroll; in landscape, the ChatGPT action was reachable by scrolling. Accessibility inspection exposed labeled controls and actions. Screenshots in this directory show these states.

Scope: visual and reachability check only. No prompt submitted, provider connected, live model called, gameplay exercised, or physical-device performance measured. Software rendering on an emulator does not establish performance on a recent midrange Android phone.
