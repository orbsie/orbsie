# Interrupted review continuation fixture

An isolated production build ran the real editor and software canvas renderer
with deterministic interception of one create response and one review HTTP 502.
The create committed and saved revision 3. The review failure left that revision
and its entity IDs intact, then displayed a **Continue improving** action in the
parent chat. Clicking the action drafted a prompt from the original request; it
made no additional generation or review request. Undo changed the revision and
hid the stale action. Desktop and 390×844 screenshots show the control visible
without horizontal overflow.

`report.json` records two intercepted requests and zero live model calls. This
proves the local UI and saved-scene behavior for a synthetic failure. It does not
prove recovery from a live provider failure or that a later user-submitted
continuation produces a high-quality scene. The fixture lantern is deliberately
simple and is not visual-quality evidence.
