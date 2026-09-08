# Adaptive resolution while editing

The renderer previously adapted to 960×600, then typing reset its backing buffer to 1280×800. The installed React Three Fiber renderer reapplies the Canvas DPR prop during parent configuration. The original Canvas passed a fixed range, while adaptation changed only the internal renderer state.

World now owns the current adaptive DPR and supplies that numeric value to Canvas. Typing, selection and scene revisions preserve it; logical viewport resizing still recalculates the budget.

`node scripts/verify-adaptive-resolution-browser.mjs` applies a bounded artificial slow-frame stimulus to a real editor, waits for adaptation, then checks typing and selection. All three states remained 960×600, with no page errors. The screenshot was reviewed. This is a functional regression check, not a performance benchmark; real Blender workload measurements are tracked separately.
