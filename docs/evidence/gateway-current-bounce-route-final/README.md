# Gateway current seven bounce route — final harness handoff

The two raw browser attempts in `gateway-current-bounce-route-attempt-1/` and
`gateway-current-bounce-route-attempt-2/` are immutable run artifacts. They were
captured under repository commit `6a4f29d7b7737ee9fcb67f9270be8e91442f058c`
before the final harness-only corrections below.

The reviewed harness adds Gateway’s explicit hyphenated stage IDs to
route analysis and makes a bounded no-ground interval fail closed unless its
end reaches the final bounce ascent. Focused helper tests pass 7/7 after this
correction. No browser or model run was repeated.

The raw run result remains partial: attempt 1 observed all three bounce
transitions and score 7 but no portal win/reset; attempt 2 observed p1 and p2
but missed p3 under a different moving-path phase.

Root review additionally rejected NaN and negative-infinity interval bounds;
9 focused tests passed. `reviewed-trace.json` reanalyzes the immutable first
run with exact Gateway IDs:106 samples, zero ground contacts from initial
release through final bounce ascent, zero later jump presses, and score7.
This is analysis of existing telemetry, not another browser attempt. Root
also reviewed the score7 failure screenshot. Portal win/reset remain open.
