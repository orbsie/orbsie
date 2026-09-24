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

A later production build capped the software canvas backing resolution at one
pixel per CSS pixel for phone-sized viewports. The same Android emulator showed
the planet in [portrait](landing-android15-dpr1-portrait.png) (412 × 786 CSS)
and [landscape](landing-android15-dpr1-landscape.png) (866 × 308 CSS). The
backing sizes matched those CSS sizes. A six-second settled `requestAnimationFrame`
sample improved from a 50 ms median to 33.4 ms in both orientations. The
observed 95th percentile was 83.3 ms in portrait before and after, and
improved from 100 ms to 83.3 ms in landscape. These are emulator observations,
not repeatable physical-device benchmarks. The first landscape screenshot
exposed a graphics-guidance banner overlapping the composer. A later production
build moved the collapsed banner below the composer in short coarse-pointer
landscape viewports and hid its duplicate bottom status text. The
[rechecked screenshot](landing-android15-landscape-guidance-fixed.png) is from
the actual Android browser at 866 × 308 CSS pixels; measured DOM rectangles
showed a 4.95px vertical gap and no overlap with the topbar controls.
