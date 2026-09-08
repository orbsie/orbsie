# Standalone readiness

The standalone player loads project data before mounting the scene, then waits for a gameplay frame with installed input listeners before showing its score as ready. Browser checks await this signal instead of guessing a startup delay. A terminal WebGL failure replaces the opening message with the specific failure.

`unavailable.json` and `webgl-unavailable.png` verify the actual standalone browser with WebGL disabled. The expected context-creation error was recorded; no unrelated page errors occurred. The specific failure is visible and the score remains hidden. The screenshot was visually inspected.

Successful readiness, scoring, outcomes and restart are covered by the saved ChatGPT command replay in `../game-program-chatgpt/run-ready-replay/report.json` and current-runtime playback in `../game-program-chatgpt/runtime-replay.json`. These runs use no inference and are labeled accordingly.
