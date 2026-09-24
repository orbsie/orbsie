# OpenRouter blue-strawberry proportion acceptance

One isolated local browser run used `openai/gpt-6-luna`, standard service tier,
the 4,096-token output cap, and the prompt `a tree with blue strawberries`.
The guarded harness made exactly three live calls (create, review, final review),
all HTTP 200, with no retries or blocked calls. The initial scene reached
revision 13; the first visual and structural review revised it to revision 19.
The final review returned `revise`, so this run is **bounded-incomplete**.
Revision 19 survived reload and the provider key was absent from browser
storage.

The sanitized [report.json](report.json) shows five lathe parts among 25
custom parts at both captures. The first review moved all five lathe parts from
the `halfToOne` declared scale-factor bin to `belowHalf`; these bins describe
transforms, not measured mesh dimensions. This proves the model used the new
shape capability and reduced scale, but does not establish correct placement
or visual quality.

Astra inspected the private final capture at
`/tmp/orbsie-authoring-review-private-proportion-20260924/post-review-scene.png`.
It shows a tree-like form with most blue fruit hidden behind the canopy and
only a tiny visible fruit. The requested subject is not yet clear at play-camera
scale. Private screenshots and the provider key are excluded from this repo.
