# Gateway checkpoint resume — partial live acceptance

Harness commit: 9251381. Application source supplied as 9098500.

One authorized Gateway Luna request returned HTTP 200, capped at 4,096 output tokens with low reasoning and default service tier. No retries. This resumed the preserved revision-33 checkpoint with five hash-verified reconstructed models; it was not a fresh creation run.

Revision 40 reduced platform-2 speed from 1.2 to 0.6 and added crystal-6 and crystal-7 while passing the existing entity-preservation assertions. All seven generated model files were captured. The saved game contains seven collection rules incrementing the crystals variable, and a portal collision win rule conditioned on crystals >= 7.

The run failed at the Play HUD expectation `.game-hud strong span` showing `/7`. The screenshot shows `0 Score` without a denominator. Root visually reviewed that screenshot. Actual traversal/win gating, reload, undo, export, and standalone playback were not reached and remain unverified by this run. The saved rules alone do not prove runtime behavior. No giant-mushroom sizing acceptance is claimed.

The temporary credential file was deleted after the run. Subsequent investigation must reuse these artifacts without repeating inference merely to bypass the HUD failure.
