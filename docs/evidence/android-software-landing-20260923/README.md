# Android software landing check

The current production build was served locally to an Android 15 midrange
emulator in Chrome at a 412 × 786 CSS viewport. A page-local test hook made
WebGL context creation return `null`, exercising Orbsie's normal software
fallback. After six seconds, the renderer reported `ready` and the screenshot
showed the new planet and star field behind the landing composer:
[`landing-android15.png`](landing-android15.png).

The app did not fall back automatically in this emulator because its WebGL2
context reports success even though the emulator fails to composite WebGL
pixels. A separate minimal red-canvas test exhibited the same compositor
fault. This screenshot verifies the forced software path on the emulator, not
automatic detection or physical-device graphics behavior. No provider call
was made.
