# OpenRouter support contact run

One authorized live run used exactly two OpenRouter calls with `openai/gpt-5.6-luna`, low reasoning, default service tier, local-only scope, and a 4096 output cap. Both responses returned HTTP 200; no fallback or external request occurred. The app and harness checkout were the clean source commit `2e0404074e4367b2886c30cfe079ca0df9c4a242`.

The creation produced a generated island and catalog tree. The ordinary edit selected the same `friendly-tree` ID and changed it to catalog `kenney.nature.mushroom-red`, tint `#ff69b4`, scale `[12,12,12]`, position `[0,0.6,0]`, with no rotation or parent. The exact before/after snapshots are [mushroom-replacement-before.json](./openrouter/mushroom-replacement-before.json) and [mushroom-replacement-after.json](./openrouter/mushroom-replacement-after.json); the complete export is [world.zip](./openrouter/world.zip).

Manual support-contact calculation from the saved snapshot and catalog metadata:

- Mushroom source minY is `-0.05`; edited base = `0.6 + (-0.05 × 12) = 0.0`.
- Generated island minY/maxY is `[-0.2, 0.2]` at position y `-0.2`; support top = `-0.2 + 0.2 = 0.0`.
- Ground/support gap = `0.0 - 0.0 = 0.0`, so the prior negative-gap defect is corrected.

The harness measured transformed dimensions growing from `[0.8305000594000002,1.8786761521000002,0.7192339000000001]` to `[2.0876065812,2.4335999999999998,2.410559976]`. This proves numeric physical expansion and catalog selection. [standalone-playback.png](./openrouter/standalone-playback.png) shows the grounded pink object; its silhouette remains angular/gem-like, so recognizable cap/stem quality is a separate visual limitation.
