# Standalone provider acceptance guard

The strengthened `verifyStandalone` check replayed an existing local export
with SHA-256 `7e5e15ea913cce6c9cd0c33852844e6ddde33e9c8c0d4d76fb67b6cdfd10a007`.
It required runtime readiness and permitted only the temporary static export
origin. Readiness was observed at 1336.8 ms, with zero blocked external
requests and zero page errors. The screenshot was visually inspected.

This was offline replay in headless Chromium with SwiftShader. No provider
call, authentication, publication or fresh generation occurred. The timing
includes navigation and assertion overhead and is not a representative
hardware performance claim. This validates the successful standalone path;
it does not retroactively certify the complete provider workflow.
