# OpenRouter blue-strawberry lathe acceptance

One isolated local browser run used `openai/gpt-6-luna`, default service tier,
the 4,096-token output cap, and the prompt `a tree with blue strawberries`.
The malformed-origin preflight returned HTTP 400 with zero inference calls.
The guarded browser run made exactly three calls, with no retries or blocked
calls: create, review, and final review. Each returned HTTP 200.

The initial save contained five ready entities: four custom and one catalog
asset. Its 20 procedural parts had four blue and 16 green parts; entity colors
included four blue and one green. The first visual+structural review examined
revision 11 and requested changes bound to revision 17. The final
visual+structural review examined revision 17 and returned `revise`, so the
result is **bounded-incomplete**. The saved structure at revision 17 retained
the same structural counts and survived reload. The API key was absent from
browser storage, and no external requests were blocked. Browser diagnostics
recorded zero console/page errors and one request failure.

The sanitized call and structure report is in [report.json](report.json). The
private post-review scene capture for Astra to inspect is
`/tmp/orbsie-authoring-review-private-lathe-20260924/post-review-scene.png`;
its directory is mode 0700 and the PNG is mode 0600. Private screenshots and
the local provider key are excluded from this repository.

Astra inspected that capture: the scene shows a tree-like green form with two
very large, smooth blue forms beneath it. Their silhouette and relative size
still do not read as strawberries on a tree, and the image does not show clear
calyx or seed detail. This agrees with the final `revise` verdict. The
sanitized report currently counts colors and parts but not part shapes, so it
does not establish whether the model selected the new lathe shape.
