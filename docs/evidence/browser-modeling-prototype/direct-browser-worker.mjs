import Module from "manifold-3d";
const start = performance.now();
const wasm = await Module();
wasm.setup();
const initializationMs = performance.now() - start;
self.onmessage = () => {
  const ready = performance.now();
  const objects = [];
  const keep = (value) => (objects.push(value), value);
  try {
    const box = keep(wasm.Manifold.cube([6, 4, 1.5], true));
    const cylinder = keep(wasm.Manifold.cylinder(2, 1.8, 1.8, 48, true));
    const cutter = keep(cylinder.translate([0, -1, 0]));
    const arch = keep(box.subtract(cutter));
    const taller = keep(cutter.scale([1, 1.2, 1]));
    const edited = keep(box.subtract(taller));
    const inspect = (shape) => {
      const bounds = shape.boundingBox();
      return {
        numTri: shape.numTri(),
        volume: shape.volume(),
        boundingBox: [bounds.min, bounds.max],
        status: shape.status(),
      };
    };
    self.postMessage(
      JSON.stringify({
        scope: "Direct Manifold browser Worker; no app integration",
        versions: { manifold: "3.3.2" },
        initializationMs,
        constructionAndInspectionMs: performance.now() - ready,
        arch: inspect(arch),
        edited: inspect(edited),
        inferenceCalls: 0,
      }),
    );
  } finally {
    for (const object of objects.reverse()) object.delete();
  }
};
self.postMessage({ ready: true });
