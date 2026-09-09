import type { Command } from "./protocol";

export const localModelingInstructions = `When localModeling is true, use kind generated with a typed local Blender job for genuinely new shapes that benefit from custom meshes, extrusions, lathes or modifiers. Mix useful catalog, procedural and generated geometry; new-only still forbids catalog reuse. Reserve the entity first without geometry, optionally provide a procedural coarse preview, then send one refined generated job. Do not repeat the same Blender job for coarse and refined stages. Never supply the model metadata field: the trusted local executor creates it. Jobs use Y-up coordinates, radians for XYZ rotation, positive scale, and hex colors. Extrude profile points [x,y] along Z using depth; lathe profile points [radius,height] around Y. Primitive box/sphere/cylinder/cone have size/diameter 2 before scaling. Set collision platform only for a generated walkable platform; otherwise use none. Use bounded, low-complexity jobs. No Python, URLs or files. Preserve stable entity IDs on edits. Use set_material for a recolor without rebuilding the mesh.`;

export const browserModelingInstructions = `When browserModeling is true, use kind generated with a browser-manifold recipe shaped as {backend:"browser-manifold",recipe:{version:1,revision,output,nodes}} for genuinely new shapes. The browser builder supports only centered box(size), sphere(radius, segments), cylinder(radius, depth, axis x/y/z), revolve(profile, segments), extrude(profile, depth), bounded closed triangle mesh(vertices, triangles), capped open tube(path, radius, segments), transform(input, position, rotation, scale), and boolean union/subtract/intersect nodes. Mesh nodes use 4–4096 finite Y-up vertices within ±100 meters and 4–8192 triangles; they must form one connected, positively oriented closed shell with no duplicate, unused, degenerate, overlapping, or self-intersecting triangles. Mesh validation is bounded and fail-closed; use separate graph nodes for compound solids. Tube paths use 2–63 unique Float32-normalized Y-up points within ±100 meters, radius greater than 1e-4 and at most 50 meters, and 3–64 radial segments (default 16). Tubes are open polylines with flat caps; reject closed loops, repeated endpoints, variable radius, twist, and custom profiles. Reject ambiguous reversals, degenerate segments, self-overlap, and generated vertices outside ±100 meters. Revolve profiles use [radius,height] points with nonnegative radius and a full 360-degree sweep around Y, preserving the explicit heights without automatic centering; segments default to 32 (maximum 64). Extrude profiles use [x,y] points along Z, centered from -depth/2 to +depth/2. Both profiles are simple closed polygons with 3–64 distinct points and implicit closing edges; do not repeat the first point, request holes, or request a partial sweep. Keep recipes within 64 nodes, depth 16, segments 64, and the evaluator's 100,000-triangle and 8 MiB intermediate mesh limits; the baked GLB must stay within 2 MiB. Dimensions and positions are meters in a Y-up world; rotations are radians using XYZ order; scale is positive. Reserve the entity first without geometry, then send one refined browser job; do not send a coarse browser job. Never supply model metadata: the trusted browser builder creates it. Every node ID must be unique. recipe.output must exactly match an existing node ID; every node must be reachable from that output. Node IDs are separate from the scene entity ID. For one-node extrusion, use output:"mesh" and nodes:[{id:"mesh",kind:"extrude",profile:[[-1,-1],[1,-1],[0,1]],depth:1}]. Preserve editable recipe revisions and stable node/entity IDs on edits. Follow new-only rules. Do not pair this backend with Blender, and do not claim support for partial sweeps, scripts, URLs, or external assets.`;

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
        "Browser modeling is unavailable. Use a browser with Web Workers and WebAssembly support.",
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
      "This modeling job is unsupported. Request a browser-manifold recipe instead.",
    );
  if (command.geometry.model)
    throw Error("Generated model identities must come from the local builder.");
  if (command.geometry.detail !== "refined")
    throw Error(
      "Local Blender jobs must provide refined geometry; use a procedural preview first.",
    );
}
