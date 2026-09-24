# OpenRouter three-call authoring review: correction persisted, review partial

A fresh isolated local production-browser run used `openai/gpt-6-luna`, standard
processing, and at most 4,096 output tokens per call. Generation committed
revision 14. The visual and structural review returned `revise` and a targeted
correction bound to revision 16. The final review examined revision 16 with a
matching project ID, authoring run, screenshot revision, and structural
observation revision. It returned HTTP 200 with a verdict of `revise`, leaving
the run **bounded-incomplete** after exactly three live calls. There were no
automatic retries or blocked external browser requests.

The browser saved revision 16 and recovered the same project/revision after
reload. The OpenRouter API key was absent from browser storage. There were no
page or console errors; one browser request failure was recorded. The private
scene screenshot was inspected: a blue spherical tree, a pink faceted mushroom,
stepping stones, and an arch are visible. The shapes are readable as a simple
play space, but this is not a high-quality or accepted result; the final review
reported at least one remaining issue. The screenshot was captured before the
harness corrected its canvas-only masking and therefore includes overlaid UI;
it remains outside the repository in a mode-0700 directory. Future captures
mask the UI before writing the private scene image.

The preceding failed run's final-review 502 did not reproduce. This run cannot
identify that earlier error's cause; the new safe failure classification will
make a future occurrence diagnosable without logging model content or keys.
The sanitized [report.json](report.json) contains only request IDs, bindings,
counts, digests, and outcome metadata.
