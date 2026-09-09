import { Matrix4 } from "three";
import {
  applyRootPositionOverride,
  resolveSceneTransforms,
  type ResolvedScene,
  type SceneGraphInput,
  type Vec3,
} from "./scene-transform";

// Project snapshots are immutable. Sharing their resolved graph avoids resolving
// every ancestor separately for each rendered entity and each collision query.
const resolvedSnapshots = new WeakMap<SceneGraphInput, ResolvedScene>();
const hierarchySnapshots = new WeakMap<SceneGraphInput, boolean>();
/** Cache feature detection too: Formation calls this once per entity/frame. */
export function usesSceneHierarchy(snapshot: SceneGraphInput): boolean {
  const cached = hierarchySnapshots.get(snapshot);
  if (cached !== undefined) return cached;
  const enabled =
    !!snapshot.groups?.length ||
    snapshot.entities.some(
      (entity) => !!entity.parentId || entity.rotation !== undefined,
    );
  hierarchySnapshots.set(snapshot, enabled);
  return enabled;
}

export function resolveRuntimeScene(snapshot: SceneGraphInput): ResolvedScene {
  let scene = resolvedSnapshots.get(snapshot);
  if (!scene) {
    scene = resolveSceneTransforms(snapshot);
    resolvedSnapshots.set(snapshot, scene);
  }
  return scene;
}

type MovingEntity = {
  id: string;
  stage: "seed" | "coarse" | "ready";
  behavior?: {
    type: string;
    axis?: "x" | "y" | "z";
    speed?: number;
    amplitude?: number;
  };
};

/** Legacy motion axes and game path positions are scene/root-space values.
 * Keep the exact inherited linear transform, including shear. A path override
 * suppresses legacy sinusoidal movement, matching existing GameSession rules.
 * The returned matrix belongs to the caller; cached graph matrices stay intact.
 */
export function runtimeEntityMatrix(
  scene: ResolvedScene,
  entity: MovingEntity,
  time: number,
  positionOverride?: Vec3,
): Matrix4 {
  const node = scene.entities.get(entity.id);
  if (!node) throw Error("The runtime object is missing from its scene.");
  if (positionOverride)
    return applyRootPositionOverride(node.worldMatrix, positionOverride);
  if (entity.stage !== "ready" || entity.behavior?.type !== "move")
    return node.worldMatrix.clone();
  if (!Number.isFinite(time)) throw Error("Scene time must be finite.");
  const position: [number, number, number] = [...node.worldPosition];
  const axis = entity.behavior.axis ?? "y";
  const index = axis === "x" ? 0 : axis === "y" ? 1 : 2;
  position[index] +=
    Math.sin(time * (entity.behavior.speed ?? 1)) *
    (entity.behavior.amplitude ?? 0.5);
  return applyRootPositionOverride(node.worldMatrix, position);
}
