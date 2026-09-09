import type { Command } from "./protocol";

export const localModelingInstructions = `Local Blender is available only when localModeling is true. When available, use kind generated with a typed job for genuinely new shapes that benefit from custom meshes, extrusions, lathes or modifiers. Mix useful catalog, procedural and generated geometry; new-only still forbids catalog reuse. Reserve the entity first without geometry, optionally provide a procedural coarse preview, then send one refined generated job. Do not repeat the same Blender job for coarse and refined stages. Never supply the model metadata field: the trusted local executor creates it. Jobs use Y-up coordinates, radians for XYZ rotation, positive scale, and hex colors. Extrude profile points [x,y] along Z using depth; lathe profile points [radius,height] around Y. Primitive box/sphere/cylinder/cone have size/diameter 2 before scaling. Set collision platform only for a generated walkable platform; otherwise use none. Use bounded, low-complexity jobs. No Python, URLs or files. Preserve stable entity IDs on edits. Use set_material for a recolor without rebuilding the mesh. If Blender is unavailable, do not output generated geometry or claim Blender ran.`;

/** Model output may request construction, but cannot assert trusted artifact identity. */
export function assertModelingCommand(command: Command, available: boolean) {
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
