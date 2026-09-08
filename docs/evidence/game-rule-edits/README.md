# Rule edits during play

The deterministic-generation browser run uses the real editor and three streamed command responses. A material edit preserves score 2; changing the input rule restarts play at score 0, displays the restart notice, and the next right input applies the new +5 rule. No model calls or page errors occurred.

`before-notice-fix.json` preserves the original missing-notice failure. The current `report.json` and `rule-edit.png` pass. Session tests distinguish semantic rule changes from first load, explicit restart, project switches and equivalent snapshots. The store regression invokes the modeling progress callback to verify that a later progress message does not erase the restart reason at completion.

The full suite in this environment passed 395 tests with six skipped: three opt-in database tests and three Blender runtime tests whose temporary packaged runtimes are absent. Build and TypeScript checks passed. This is not live-provider or packaged-Blender acceptance evidence.
