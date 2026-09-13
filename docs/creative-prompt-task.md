# Creative and playable authoring prompt implementation

Owner explicitly approved implementing all Astra investigation recommendations.
This is the bounded prompt change within that sequence, after capture handoff.
One Luna worker; no nested agents or live calls. Root owns review/integration.

## Ownership

src/lib/server/generation.ts shared prompt assembly, a small pure authoring prompt
module if useful, src/lib/modeling-policy.ts only if needed to separate guidance
from hard limits, and focused prompt/adapter regression tests. Preserve others'
work. Do not change protocol schemas, scene behavior, model choices, output caps,
wire formats, catalogs or charging. Hosted chatgpt-scene-stream already imports
systemPromptForCapabilities, so retain one semantic contract for all providers.

## Required implementation

Refactor the dense base prompt into named prioritized sections: current user intent
and preservation; artistic intent; playable experience; staged authoring; supported
capabilities and output. Retain every existing functional constraint, including
hierarchy/TRS/shear restrictions, island bounds, game references, bounce+move_path
composition, jump-speed/gravity margins, catalog/new-only policies and browser
procedural restrictions. Syntax and validation remain authoritative. Preserve
NDJSON/json-object/json-schema/strict-schema wrappers and modeling examples' format
adaptation. Avoid increasing the overall prompt materially; report before/after
character and byte sizes across relevant capability/format combinations.

Art direction: requested subject/mood/distinctive detail; recognizable silhouette;
deliberate proportions; coherent restrained palette with purposeful accents; focal
hierarchy and supporting scenery; geometry spent on play-camera-visible details;
believable contact/support; intentional form variation with consistent related
objects. Scoped edits preserve established direction. Do not mandate a fixed style,
fixed prop arrangement or template catalogue. Do not force tree height2 when the
user explicitly asks for a giant: make conservative size guidance conditional.

Games: clear player action and reachable objective, visible feedback, appropriate
completion/reset using supported mechanics; essential route/interactions before
decoration; clear spawn/path; platform tops/gaps/motion endpoints within player
capabilities. Appearance must not imply unsupported collision/interaction. Do not
force win/loss on exploratory worlds. Retain complete rules baseline for edits.

Clarify recommended16 custom parts versus actual schema32 hard limit. Derive hard
limits from existing exported definitions where practical, without unrelated
schema refactors. Avoid a new planning model call. Do not claim visual inspection
happens until the separate loop executes it. Progress remains factual summaries.

## Targeted acceptance

Test shared semantics survive every existing format/capability branch and hosted
adapter assembly. Retain schema/wire-format, stable IDs, asset-policy and concrete
gameplay constraints. Relevant existing suites: generation-envelope,
generation-output-format and chatgpt-scene-stream (locate actual filenames).
Add focused coverage for the new creative/game semantics without snapshotting
large schema strings or asserting arbitrary prose punctuation. Typecheck once.
Report changed files, checks, prompt size delta, assumptions and risks concisely.
Prompt quality improvement remains unproven until the controlled Luna evaluation
specified in docs/visible-authoring-task.md; do not run live evaluation in this task.
