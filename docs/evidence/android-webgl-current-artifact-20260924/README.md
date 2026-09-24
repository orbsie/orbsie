# Android current player with WebGL allowed

The Android 15 emulator Chrome test allowed WebGL requests and replayed the
current checked-in standalone player files over an ADB-reversed local HTTP
server. The fixture used an existing saved ZIP; it made no model calls. Touch
score 7, restart, win and loss passed at 412×786 without overflow, unexpected
network traffic or page errors. Root inspected the winning screenshot.

The single WebGL2 context in `report.json` came from Orbsie's renderer
capability probe. Its unmasked renderer was **Android Emulator OpenGL ES
Translator (Google SwiftShader)**. The current `World` implementation detects
that exact software-emulated renderer and deliberately selects Canvas2D. The
player's visible compatibility-graphics notice and `.software-world` confirm
the fallback. This run therefore **does not accept Android WebGL rendering**;
it confirms playable fallback even when the browser advertises WebGL2. A
physical Android device, or an emulator with a genuinely different GPU
renderer, is still needed for Android WebGL and performance acceptance.

The checked-in `ready.png`, `scored.png`, `won.png` and `lost.png` are the
observed device screenshots. The verifier closed its tab, server and ADB
forwarding, removed the temporary artifact, and stopped the emulator.
