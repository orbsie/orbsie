# Formation revision continuity

The shared World renderer now samples the current eased positions and authored colors before replacing geometry. The next morph starts from that snapshot rather than the prior target. Sampling occurs at layout commit before disposal of the previous geometry. Gameplay tint remains an immediate override.

Validation: `npx vitest run tests/geometry.test.ts`, `npx tsc --noEmit`, and `node scripts/verify-formation-continuity.mjs`.

The isolated real-WebGL fixture interrupts tree, platform, and arch formation at 40%, then applies refined geometry and a color change. It checks the actual renderer's next source attributes against independently calculated visible values, checks shader compilation errors, and captures start/midpoint/finished images and a recording. No provider calls or external requests are made. The first harness attempt failed because it queried the canvas root before mount; the readiness guard was corrected.

Scope limitation: modulo vertex correspondence preserves sampled positions and colors, not surface connectivity across topology changes. Visual inspection of the midpoint shows jagged intermediate surfaces. This evidence establishes the interrupted-morph reset fix; it does not establish the plan's complete formation visual-quality gate or normal-GPU performance. A surface/particle bridge for incompatible topology remains required.
