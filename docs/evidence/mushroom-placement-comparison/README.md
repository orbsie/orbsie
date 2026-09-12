# Mushroom placement comparison

This bounded local comparison renders the exact `kenney.nature.mushroom-red` catalog asset through the shared `World` renderer at the saved transform (`y=0`) and corrected bounds-grounded transform (`y=0.7`). The checked-in GLB was loaded as 6,364 bytes with SHA-256 `843e2de43dce78920a5675a67bac4b72f500e6220315e713fe08381642cfc571`; the worker reported the exact same response bytes. No provider, model, account, or external request was used.

The saved capture is [saved-y.png](./saved-y.png); the grounded capture is [grounded-y.png](./grounded-y.png). Both use the same settled camera (`[13,15,20]`) and the island parent is the identity matrix. The actual rendered and runtime-coordinate bounds match exactly (`maxPresentationToRuntimeBoundsDelta=0`). Minimum Y is `-0.7000000104` for saved `y=0` and `-0.0000000104` for grounded `y=0.7`, confirming the corrected node offset places the asset on the island surface.

Visually, the grounded pink asset meets the island and reads as a broad faceted cap over a narrower lower stem-like section. Uniform pink still gives it a gem-like appearance, but the omitted node offset was the placement defect isolated by this comparison. The prior failed harness run remains in `report.attempt-1-harness-timeout.json`; its report is not overwritten.
