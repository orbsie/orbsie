# Gateway captured offline continuation

One offline browser run used the explicit captured-artifact mode against the
local server at `http://127.0.0.1:3068` (application source supplied as
`7c0eec718c35cfc5539090b73995d0e88f326519`). The baseline mushroom snapshot is
revision 30 with source hash
`025e2d5d40a486dcd9944e0ff08cb921de0f826184f7cc3d6fbef06aa39a9def`; the
goal-7 snapshot is revision 37 with source hash
`38606a52068206da403dd22f85fe7a97dca2eafc51e600249d3445d34b7e2dac`.

The run passed exact edited reopen, Score HUD at zero, edited reload and
goal-7 export with two generated GLBs, seeded undo to the five-crystal
baseline at revision 38, baseline reload/export, and standalone playback.
There were zero generation requests, generation responses, budget violations,
external requests, or page errors. Undo evidence uses the captured baseline
seeded into local history; it is not the original live model run's history.

The report is `gateway.json`. Evidence under `gateway/` includes the edited snapshot, HUD and
standalone screenshots, and the separate `world-goal-7.zip` and `world.zip`
exports. This remains an offline continuation milestone; it does not establish
live generation, gameplay traversal, publication, mobile, or final visual
quality acceptance.
