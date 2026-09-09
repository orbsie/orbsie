# Scene hierarchy production release

Source `d92421e` deployed to https://orbsie.com through
https://orbsie-f9n99xuzt-grappeggias-projects.vercel.app . Vercel deployment
ID: `62z3rpuGtijsE5cXa7Wa9kiHF6gt`. The production build and type checks passed;
ChatGPT hosted connection/generation flags remained enabled.

The read-only production smoke passed homepage rendering, unauthorized journal
access returning 401, and exact player/geometry/procedural worker and WASM
hashes. The canvas/composer were visible with no page errors, external requests
or non-GET requests. The landing screenshot was visually inspected. No model
inference was submitted by the release check.

Acceptance includes the reviewed editor create/group edit/selected-child edit,
undo/redo, reload and ZIP standalone tests in
`../scene-hierarchy-editor-20260909-r4/`, plus actual keyboard jump, landing and
parent rotation/scale/translation carrying in `../hierarchy-carrying-20260909-r7/`.
The latter uses read-only scene observation and measured carrying error below
1e-14 with stable post-edit samples. Earlier fixture failures remain preserved.
Full deterministic regression passed 822 tests, seven skipped. The ChatGPT
route-trace/private-file verifier also passed.

This releases browser-tested hierarchy implementation. It does not certify
live model-authored hierarchy/procedural quality, real ChatGPT consent and
generation, Gateway BYOK, fresh full provider publication workflows, or
representative device performance. Those full-goal gates remain open.
