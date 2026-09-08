# ChatGPT-authored gameplay

Two actual local ChatGPT `gpt-6-astra` low/default requests each produced the requested three-rule program on a deterministic starter scene. Both HTTP responses, command streams and editor gameplay checks passed. The original reports are retained at `report.json` and `run-queued-input/report.json`; both correctly remain failed overall because the standalone keyboard check ran before a reliable ready signal.

The first failure prompted preservation of short input edges between frames. The second showed that this did not solve startup readiness: the score could appear before the first gameplay frame and input listeners were ready. The standalone player now mounts after project loading and keeps its opening state until a gameplay frame confirms listeners are registered. WebGL failure replaces loading with the specific error.

`run-ready-replay/report.json` records the saved second response replayed through the editor and a newly downloaded ZIP after this fix, without inference. Scoring, held input, win, loss, restart, unchanged entities, program/source preservation, and independent playback passed. `runtime-replay.json` additionally verifies the original live-authored project with the current rebuilt runtime and a press/release inside one browser task. These replays do not represent new model calls. Screenshots were visually inspected.

The browser requests pass through a test HTTP bridge to the actual authenticated local companion during live mode. This does not test the settings pairing flow, production subscription relaying, full scene creation, cloud recovery or publication.

Use `ORBSIE_LIVE_E2E=1 ORBSIE_EVIDENCE_RUN=NAME node scripts/verify-live-chatgpt-game.mjs` for an explicitly authorized live test. Use `ORBSIE_GAME_COMMAND_REPLAY=docs/evidence/game-program-chatgpt/run-queued-input/report.json ORBSIE_EVIDENCE_RUN=NAME node scripts/verify-live-chatgpt-game.mjs` to replay saved commands without inference. Both expect the local app at port 3024. Evidence run names create separate subdirectories so prior failures remain reviewable.
