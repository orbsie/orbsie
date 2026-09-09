# Hierarchy regression checkpoint

Source: `fd1382a`, runtime/assets `0870f83`.

The full deterministic `npm test` run passed 108 files with two skipped files:
822 tests passed and seven were skipped (829 total). Duration was 6.80 seconds.
The initial run found one stale assertion in `tests/modeling-store.test.ts`:
provider-supplied trusted metadata is rejected by the model schema and reports
the current concise invalid-scene message, while the test expected an older
backend-specific message. The correction retains the no-builder-call assertion
and additionally verifies that the finished geometry is unchanged. Its targeted
run and the full suite then passed.

Separate hierarchy journal coverage in `8113663` passed all 22 tests in
`tests/generation-runs.test.ts`. This uses a mocked database with real service
append/read/replay functions. It exercises a ready child, coarse replacement,
reparenting, removal of the old parent, interruption and replay, preserving
ready geometry and unrelated transforms. It also checks atomic cycle rejection
and owner isolation. This is not evidence from a deployed database.

The model-facing hierarchy schema and coordinate instructions were enabled
locally in `5e5217f`. The full editor fixture remains pending, including group
edits during play, a selected-child generated-geometry edit, exact undo/redo,
reload, ZIP asset integrity and independent playback. Do not treat basic
shared-world collection or the full deterministic suite as proof of those
workflows. No hierarchy deployment or live provider acceptance is claimed.
