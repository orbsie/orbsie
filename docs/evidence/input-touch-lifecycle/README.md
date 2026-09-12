# Touch input lifecycle evidence

This is a deterministic Playwright browser run against a local Next dev
server. It uses a mobile viewport (`390x844`, `hasTouch: true`) and Chromium
CDP `Input.dispatchTouchEvent` touch emulation. The run restores native
`setPointerCapture`; `report.json` therefore records browser-delivered touch
and capture behavior rather than injected `PointerEvent` handler calls.

The retained `synthetic-handler-fixture.json` is a separate deterministic
handler/tracker fixture. It overrides `HTMLElement.prototype.setPointerCapture`
and dispatches synthetic pointer events, so it does not certify browser touch
delivery. It remains useful for isolating the tracker semantics.

The editor and the downloaded standalone player both passed the browser
touch checks:

- simultaneous movement and jump pointers retain distinct pointer IDs;
- native pointer capture is observed, and releasing one touch with an ordinary
  touch end leaves the other action held;
- a real touch cancellation emits `lostpointercapture` and releases its action;
- a browser-dispatched blur clears held pointer state so a new press produces a
  fresh input edge;
- Space still activates a focused Restart button;
- typing in the prompt does not move the player.

The report remains `partial`: Chromium's CDP emulation clears capture after
`releasePointerCapture()` but does not emit `lostpointercapture` for that API
call, even after a real one-pixel touch move. The separate touch-cancel path
does emit it, and the synthetic fixture covers the handler's explicit
lost-capture callback. The OS-background step is a browser lifecycle-event
simulation, not an iOS or Android background certification.

The fixture transport handled one local generation request. No live inference
was made, no external requests or page errors were observed, and the standalone
ZIP was served from an isolated local HTTP server. The editor's success toast
also overlaps the touch-control hit area at this mobile viewport; the harness
dismisses it before testing. That is a remaining mobile product-layout issue.
The first CDP attempt is
retained in `failure-cdp-injection.json`: the success toast covered the button
hit coordinates, so Chromium delivered the touch to the toast. The final run
dismisses that overlay and records the control hit through the real browser
event path.

Run command:

```sh
npx next dev --hostname 127.0.0.1 --port 3027
TEST_URL=http://127.0.0.1:3027 \
TOUCH_INPUT_EVIDENCE=docs/evidence/input-touch-lifecycle \
node scripts/verify-touch-input-lifecycle.mjs
```

Evidence is in `report.json` (partial browser-touch result),
`synthetic-handler-fixture.json`,
`failure-cdp-injection.json`, `editor-touch.png`, `standalone-touch.png`, and
`world.zip`. This covers Chromium mobile emulation only; actual iOS/Android
and physical device multitouch behavior remain open for device validation.
