# Browser authoring review loop fixture

Generated against the production build with `TEST_URL=http://localhost:3047 node scripts/verify-authoring-review-loop.mjs /tmp/orbsie-review-gpt6-final-20260922`; the report and screenshots were copied into this evidence directory.

The fixture uses synthetic initial and review route responses, real WebGL/software rendering, actual canvas capture, browser IndexedDB persistence, and desktop/phone viewports. It performs one targeted correction followed by a verdict-only final review for each renderer. The signed-in branch drives both cloud journal segments through the real composer callback, verifies the acknowledged revision and snapshot token before the second PUT, reloads and recovers the completed second segment, then repeats with a conflicting latest token and verifies that no second PUT or correction segment occurs. `liveModelCalls` is zero; all HTTP responses are mocked in the browser fixture.
