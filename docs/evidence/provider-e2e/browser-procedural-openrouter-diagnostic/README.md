# Live procedural retry: invalid model update

Source `e85ca5d` passed a production build and ran locally with the corrected
origin and 512-token cap. OpenRouter Luna returned HTTP 200 and an actual
reservation was observed at 8030 ms. Generation then failed with an invalid
scene-update message; no edit request was made. This is not a passing live
procedural workflow.

The browser report did not retain the schema diagnostic because its observer
was still gated to extrusion scenarios. That harness condition was corrected
after this run. Empty diagnostics here therefore do not establish the cause
of the invalid update. One generation request occurred, with no provider
fallback or response interception.
