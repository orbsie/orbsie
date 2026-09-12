# Adaptive bake review

Root reviewed front.png and rear.png and the converter diff. Adaptive refinement
improves red/white spot outlines compared with mushroom-basic-preview, but small
dark speckles remain on the cap, including the uniformly pink comparator. This
is a visible defect independent of source texture color. No catalog admission.

The run reached 29,997 vertices/9,999 triangles and saturated its vertex budget.
Maximum sampled color error fell from0.467 to0.121, still above the0.04 target.
This metric samples edge midpoints and centroids; it is not a full fidelity bound.
Normal/finite/size/decode checks and browser readiness passed, but do not override
the failed visual review. Root has not established the cause of the speckles;
nonconforming refinement/rasterization is a hypothesis, not a verified diagnosis.

Next investigate that concrete artifact without raising geometry limits or
repeating provider calls. Historical uniform and adaptive evidence stays intact.
