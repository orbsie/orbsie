import {
  gameplayPlatformContactSurface,
  GRAVITY,
  GROUND_CENTER_Y,
  GROUND_SUPPORT_TOLERANCE,
  JUMP_SPEED,
  PLAYER_HALF_HEIGHT,
} from "./gameplay";
import type { Entity, Project } from "./protocol";

export const DIRECT_GROUND_JUMP_SCOPE =
  "direct-ground-jump-to-nearest-ready-root-unrotated-built-in-traversal-platform" as const;

export type DirectGroundJumpObservation =
  | {
      version: 1;
      status: "observed";
      scope: typeof DIRECT_GROUND_JUMP_SCOPE;
      entityId: string;
      landingCenter: [number, number, number];
      idealApexY: number;
      /** Positive is below the ideal apex; negative is a vertical shortfall. */
      signedClearance: number;
    }
  | {
      version: 1;
      status: "skipped";
      scope: typeof DIRECT_GROUND_JUMP_SCOPE;
      reason:
        | "no-game-program"
        | "no-explicit-game-spawn"
        | "spawn-not-ground-level"
        | "no-ready-built-in-platform"
        | "unsupported-platform-transform"
        | "vertical-platform-motion";
    };

function skipped(
  reason: Extract<DirectGroundJumpObservation, { status: "skipped" }>["reason"],
): DirectGroundJumpObservation {
  return {
    version: 1,
    status: "skipped",
    scope: DIRECT_GROUND_JUMP_SCOPE,
    reason,
  };
}

function isUnrotated(entity: Entity) {
  return (
    entity.rotation === undefined ||
    (entity.rotation.length === 3 &&
      entity.rotation.every((value) => value === 0))
  );
}

function hasVerticalMotion(project: Project, entity: Entity) {
  const behavior = entity.behavior;
  if (
    behavior?.type === "move" &&
    (behavior.axis ?? "y") === "y" &&
    (behavior.speed ?? 1) > 0 &&
    (behavior.amplitude ?? 0.5) > 0
  )
    return true;

  for (const rule of project.game?.rules ?? []) {
    for (const action of rule.actions) {
      if (action.type === "set_position" && action.entityId === entity.id) {
        if (action.position[1] !== entity.position[1]) return true;
      }
      if (action.type === "move_path" && action.entityId === entity.id) {
        if (action.points.some((point) => point[1] !== entity.position[1]))
          return true;
      }
    }
  }
  return false;
}

/**
 * Estimate only vertical clearance for one direct jump from a settled ground
 * spawn to the nearest built-in traversal platform by its authored base
 * position. Static ground/island platforms are support surfaces, not traversal
 * targets. Horizontal motion, steering, and contact are not modeled; this is
 * advisory, not route validation.
 */
export function observeDirectGroundJump(
  project: Project,
): DirectGroundJumpObservation {
  if (!project.game) return skipped("no-game-program");
  const spawn = project.game.spawn;
  if (!spawn) return skipped("no-explicit-game-spawn");
  const minGroundSpawnY = GROUND_CENTER_Y - PLAYER_HALF_HEIGHT;
  const maxGroundSpawnY = GROUND_CENTER_Y + GROUND_SUPPORT_TOLERANCE;
  if (spawn[1] < minGroundSpawnY || spawn[1] > maxGroundSpawnY)
    return skipped("spawn-not-ground-level");

  const builtInTraversalPlatforms = project.entities.filter(
    (entity) =>
      entity.stage === "ready" &&
      entity.geometry?.kind === "platform" &&
      (entity.behavior?.type === "bounce" || entity.behavior?.type === "move"),
  );
  if (builtInTraversalPlatforms.length === 0)
    return skipped("no-ready-built-in-platform");

  const rootUnrotatedPlatforms = builtInTraversalPlatforms.filter(
    (entity) => entity.parentId == null && isUnrotated(entity),
  );
  if (rootUnrotatedPlatforms.length === 0)
    return skipped("unsupported-platform-transform");

  const nearest = rootUnrotatedPlatforms
    .map((entity) => {
      const surface = gameplayPlatformContactSurface(entity, entity.position);
      const landingCenter: [number, number, number] = [
        surface.x,
        surface.y,
        surface.z,
      ];
      const distanceSquared = landingCenter.reduce(
        (sum, component, axis) => sum + (component - spawn[axis]) ** 2,
        0,
      );
      return { entity, landingCenter, distanceSquared };
    })
    .sort(
      (a, b) =>
        a.distanceSquared - b.distanceSquared ||
        (a.entity.id < b.entity.id ? -1 : a.entity.id > b.entity.id ? 1 : 0),
    )[0];

  if (!nearest) return skipped("no-ready-built-in-platform");
  if (hasVerticalMotion(project, nearest.entity))
    return skipped("vertical-platform-motion");

  const idealApexY =
    GROUND_CENTER_Y + (JUMP_SPEED * JUMP_SPEED) / (2 * GRAVITY);
  return {
    version: 1,
    status: "observed",
    scope: DIRECT_GROUND_JUMP_SCOPE,
    entityId: nearest.entity.id,
    landingCenter: nearest.landingCenter,
    idealApexY: Number(idealApexY.toFixed(3)),
    signedClearance: Number((idealApexY - nearest.landingCenter[1]).toFixed(3)),
  };
}
