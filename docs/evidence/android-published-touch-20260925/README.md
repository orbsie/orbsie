# Android published-player touch follow-up

Chrome 124 on the Android 15/API 35 `droidlm_api35_midrange` emulator loaded
the signed-out published game from the existing immutable OpenRouter-authored
Vercel URL. The first intent showed the game's opening transition; after eight
seconds the page displayed Score: 0 and the movement, Jump and Restart controls.
No Chrome onboarding, login, terms prompt or consent choice appeared.

ADB sent a 1500 ms right-control hold, a Jump tap, then one Restart tap. The
score stayed at 0, and the game canvas remained visually blank in the retained
screenshots. The Restart screenshot is byte-identical to the post-Jump screenshot,
so a reset effect cannot be confirmed. No user-visible game compatibility
switch appeared. The built-in ADB `input` command exposed one pointer per event;
simultaneous movement and Jump were not tested. With no visible world, crystals
or portal to target, score collection and win/loss were not verified.

The emulator startup log warned about the host GPU and reported its OpenGL ES
backend as SwiftShader/software rendering. No renderer override was set, and
this run did not establish whether the published page used Canvas2D or WebGL.
The blank canvas is an observation only; it does not identify an Orbsie renderer
fallback or establish a product defect.

This is an inconclusive gameplay check, not a pass. The same URL showed a
visible world in the earlier ADB smoke, so the blank capture is intermittent in
this emulator. The URL is the same immutable artifact tested while the checkout
was at `b34dad2`; its build commit was not established. It is not a fresh
publication of current source. CDP was used read-only after load to inspect
the visible text, canvas bounds and resource origins. Gameplay actions and
screenshots used ADB touchscreen input. No app or deployment files were changed,
and no model call was made. See [interactive.json](./interactive.json) for exact
actions, limits and screenshot hashes.
