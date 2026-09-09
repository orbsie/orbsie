import type { Command } from "./protocol";

export const localModelingInstructions = `When localModeling is true, use kind generated with a typed local Blender job for genuinely new shapes that benefit from custom meshes, extrusions, lathes or modifiers. Mix useful catalog, procedural and generated geometry; new-only still forbids catalog reuse. Reserve the entity first without geometry, optionally provide a procedural coarse preview, then send one refined generated job. Do not repeat the same Blender job for coarse and refined stages. Never supply the model metadata field: the trusted local executor creates it. Jobs use Y-up coordinates, radians for XYZ rotation, positive scale, and hex colors. Extrude profile points [x,y] along Z using depth; lathe profile points [radius,height] around Y. Primitive box/sphere/cylinder/cone have size/diameter 2 before scaling. Set collision platform only for a generated walkable platform; otherwise use none. Use bounded, low-complexity jobs. No Python, URLs or files. Preserve stable entity IDs on edits. Use set_material for a recolor without rebuilding the mesh.`;

export const browserModelingInstructions = `When browserModeling is true, use kind generated with a browser-manifold recipe shaped as {backend:"browser-manifold",recipe:{version:1,revision,output,nodes}} for genuinely new shapes. The browser builder supports only centered box(size), sphere(radius, segments), cylinder(radius, depth, axis x/y/z), transform(input, position, rotation, scale), and boolean union/subtract/intersect nodes. Keep recipes within 64 nodes, depth 16, segments 64, and the evaluator's 100,000-triangle and 8 MiB intermediate mesh limits; the baked GLB must stay within 2 MiB. Dimensions and positions are meters in a Y-up world; rotations are radians using XYZ order; scale is positive. Reserve the entity first without geometry, then send one refined browser job; do not send a coarse browser job. Never supply model metadata: the trusted browser builder creates it. Preserve editable recipe revisions and stable node/entity IDs on edits. Follow new-only rules. Do not pair this backend with Blender, and do not claim support for extrusion, lathe, arbitrary mesh, scripts, URLs, or external assets.`;

export function modelingInstructions(
  localModeling = false,
  browserModeling = false,
) {
  return [
    localModeling ? localModelingInstructions : "",
    browserModeling ? browserModelingInstructions : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/** Model output may request construction, but cannot assert trusted artifact identity. */
export function assertModelingCommand(
  command: Command,
  available: boolean,
  browserAvailable = false,
) {
  if (
    command.type === "reserve_entity" &&
    command.entity.geometry?.kind === "generated"
  )
    throw Error(
      "Reserve the object first, then request its local model with set_geometry.",
    );
  if (command.type !== "set_geometry" || command.geometry.kind !== "generated")
    return;
  const browserBackend = "backend" in command.geometry.job;
  if (browserBackend) {
    if (!browserAvailable)
      throw Error(
        "Browser modeling is unavailable in this client; use a supported modeling connection.",
      );
    if (command.geometry.model)
      throw Error(
        "Generated model identities must come from the browser builder.",
      );
    if (command.geometry.detail !== "refined")
      throw Error(
        "Browser modeling jobs must provide refined geometry; use a procedural preview first.",
      );
    return;
  }
  if (!available)
    throw Error(
      "Connect the local Blender companion before building this model.",
    );
  if (command.geometry.model)
    throw Error("Generated model identities must come from the local builder.");
  if (command.geometry.detail !== "refined")
    throw Error(
      "Local Blender jobs must provide refined geometry; use a procedural preview first.",
    );
}
