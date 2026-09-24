# Signed-in three-segment review fixture

The production-build browser fixture used synthetic provider and cloud routes
with the real editor and software renderer. A signed-in run made creation,
review, review, and final-review requests at scene revisions 3, 6, and 8. Each
committed phase used a separate cloud journal segment and a chained snapshot
token. After reload, cloud recovery restored revision 8, the second sky change,
and the lantern color. The conflict path stopped after the first review without
opening a correction segment. The fixture also reran the WebGL, software,
partial-review, and anonymous four-call paths. No live model calls were made.

`report.json` contains the bounded synthetic event summary. The screenshots
show the fixture scene at desktop and phone sizes; they are visual checks of
the editor and renderer, not evidence of live model quality.
