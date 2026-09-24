# OpenRouter blue-strawberry scene structure

An isolated local authoring-review run used `openai/gpt-6-luna` at the default
service tier with a 4,096-token output limit. It made exactly three authorized
live calls: creation, visual and structural review, and final review. All three
returned HTTP 200; there were no retries or blocked calls. A malformed-origin
preflight returned HTTP 400 without inference.

The initial saved scene had four ready entities and 12 custom procedural parts,
including six blue parts. Review revised the project from revision 9 to 13.
The final saved scene had four ready entities and 21 parts, including 12 blue
parts. Reload recovered revision 13, and the provider key was absent from
browser storage. The final review still requested revision, so the bounded
run ended incomplete rather than silently claiming acceptance.

Astra inspected the private scene capture: blue fruit is visible on the tree,
but the round fruit reads as blueberries rather than strawberries. This is a
shape-quality gap, not missing fruit geometry. The private screenshot and
credentials are excluded from this repository. Browser diagnostics recorded
zero console and page errors, one unclassified request failure, and no blocked
external requests. See [report.json](report.json) for sanitized evidence.
