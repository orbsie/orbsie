# Local rendering release verification

Source commit `2887219` deployed successfully to https://orbsie.com. The production build and TypeScript checks passed; the local full suite passed 415 tests with 7 explicitly skipped. The read-only production smoke verified the root page, unauthenticated journal rejection, exact player and both geometry-worker hashes, visible canvas and prompt, and no browser errors. The landing screenshot was visually reviewed. No provider generation was requested by this release smoke.

This release includes the adaptive DPR editing fix. The offline distribution assembler remains development tooling: a complete portable Blender installer and the full provider E2E matrix are not certified by this deployment.
