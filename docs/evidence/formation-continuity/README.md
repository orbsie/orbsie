# Formation revision continuity

The shared World renderer now samples the current eased positions and authored colors before replacing geometry. The next morph starts from that snapshot rather than the prior target. Sampling occurs at layout commit before disposal of the previous geometry. Gameplay tint remains an immediate override.

Validation: `npx vitest run tests/geometry.test.ts`, `npx tsc --noEmit`, and `node scripts/verify-formation-continuity.mjs`.

The isolated real-WebGL fixture interrupts tree, platform, and arch formation at 40%, then applies refined geometry and a color change. It checks the actual renderer's next source attributes against independently calculated visible values, checks shader compilation errors, and captures start/midpoint/finished images and a recording. No provider calls or external requests are made. The first harness attempt failed because it queried the canvas root before mount; the readiness guard was corrected.

Scope limitation: modulo vertex correspondence preserves sampled positions and colors, not surface connectivity across topology changes. Visual inspection of the midpoint shows jagged intermediate surfaces. This evidence establishes the interrupted-morph reset fix; it does not establish the plan's complete formation visual-quality gate or normal-GPU performance. A surface/particle bridge for incompatible topology remains required.


GPU bridge follow-up: the renderer now uses round GPU-interpolated points when vertex count or index connectivity changes, then switches to the solid target at completion. Compatible topology retains solid deformation, including recolors. The shader shares the same position/color snapshot and progress uniform; no opacity crossfade between unrelated meshes is used. Obsolete point materials are disposed with the entity. The frozen-frame fixture explicitly applies the visibility phase before rendering its snapshots, so it does not independently certify real-time phase timing.

The updated midpoint was visually inspected: tree and arch use points instead of stretched triangles. This remains a vertex-sampled bridge prototype: uneven surface density and the final solidification handoff need further visual/performance acceptance. It is not a claim that all formation-quality requirements are complete. Type checking and the three-family browser continuity/shader check passed with zero provider calls.

Real-time follow-up: the fixture now resumes the real R3F animation loop after submitting a new topology revision and observes visibility on requestAnimationFrame without manually setting progress or visibility. The recorded run settled in 922 ms: two point bridges and one compatible solid became three solids, with no sampled overlap or gap. A subsequent actual cyan recolor kept all three meshes solid throughout and settled in about 932 ms. The earlier frozen-frame limitation still applies to exact source-attribute snapshots, but no longer describes this separate real-time phase check. This software-rendered small scene does not certify the normal-laptop performance target or uniform particle density.
