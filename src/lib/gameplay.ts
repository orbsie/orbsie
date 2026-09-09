import { Matrix4 } from "three";
import { transformBounds } from "./scene-transform";
import { carrySupportContact, supportSurfaceHeight } from "./scene-support";
import { entityGeometry } from "./geometry";
import type { Entity } from "./protocol";
import { requireCatalogAsset } from "./asset-catalog";

export type Vec3 = [number, number, number];

export type PlayerState = {
  position: Vec3;
  velocityY: number;
  groundedOn?: string;
  supportPosition?: Vec3;
  supportTop?: number;
  supportMatrix?: number[];
};

export type PlayerInput = {
  x: number;
  z: number;
  jump: boolean;
};

export type GameplayStep = PlayerState & {
  collected: string[];
  contacts: string[];
  won: boolean;
};

const GROUND_CENTER_Y = 0.42;
const PLAYER_HALF_HEIGHT = 0.42;
const MOVE_SPEED = 4;
const JUMP_SPEED = 6;
const GRAVITY = 15;
// Gameplay contact treats the avatar as a small capsule: 0.22 units of
// horizontal reach and its 0.42-unit half-height. Pickups and portals use
// this same geometry-aware tolerance, so an object must touch the avatar in
// 3D rather than merely sharing its ground-plane X/Z position.
const CONTACT_HORIZONTAL_TOLERANCE = 0.22;

export function movingEntityPosition(entity: Entity, time: number): Vec3 {
  const position: Vec3 = [...entity.position];
  if (entity.stage === "ready" && entity.behavior?.type === "move") {
    const axis = entity.behavior.axis ?? "y";
    const index = axis === "x" ? 0 : axis === "y" ? 1 : 2;
    position[index] +=
      Math.sin(time * (entity.behavior.speed ?? 1)) *
      (entity.behavior.amplitude ?? 0.5);
  }
  return position;
}

export function isTextEntryTarget(target: EventTarget | null) {
  return (
    target instanceof Element &&
    Boolean(target.closest("input,textarea,select,[contenteditable]"))
  );
}

function platformTop(
  entity: Entity,
  time: number,
  positionOverride?: Vec3,
  matrix?: Matrix4,
  query?: Vec3,
) {
  const position = positionOverride ?? movingEntityPosition(entity, time);
  const bounds =
    entity.geometry?.kind === "asset"
      ? requireCatalogAsset(entity.geometry.assetId).bounds
      : entity.geometry?.kind === "generated"
        ? entity.geometry.model?.bounds
        : undefined;
  if (matrix && query) {
    const local = bounds
      ? normalizeContactBounds(bounds)
      : {
          min: [-0.55, -0.025, -0.55] as const,
          max: [0.55, 0.52, 0.55] as const,
        };
    const height = supportSurfaceHeight(matrix, local, query[0], query[2]);
    const world = transformBounds(matrix, local);
    return {
      id: entity.id,
      x: (world.min[0] + world.max[0]) / 2,
      z: (world.min[2] + world.max[2]) / 2,
      y: height === undefined ? -Infinity : height + PLAYER_HALF_HEIGHT,
      halfX: (world.max[0] - world.min[0]) / 2,
      halfZ: (world.max[2] - world.min[2]) / 2,
      bounce: entity.behavior?.type === "bounce",
    };
  }
  if (bounds) {
    const { min, max } = bounds;
    const low = min.map((value, i) =>
      Math.min(value * entity.scale[i], max[i] * entity.scale[i]),
    );
    const high = max.map((value, i) =>
      Math.max(value * entity.scale[i], min[i] * entity.scale[i]),
    );
    return {
      id: entity.id,
      x: position[0] + (low[0] + high[0]) / 2,
      z: position[2] + (low[2] + high[2]) / 2,
      y: position[1] + high[1] + PLAYER_HALF_HEIGHT,
      halfX: (high[0] - low[0]) / 2,
      halfZ: (high[2] - low[2]) / 2,
      bounce: entity.behavior?.type === "bounce",
    };
  }
  return {
    id: entity.id,
    x: position[0],
    z: position[2],
    // Reflect both vertical endpoints of the procedural platform mesh.
    y:
      position[1] +
      Math.max(-0.025 * entity.scale[1], 0.52 * entity.scale[1]) +
      PLAYER_HALF_HEIGHT,
    halfX: Math.abs(entity.scale[0]) * 0.55,
    halfZ: Math.abs(entity.scale[2]) * 0.55,
    bounce: entity.behavior?.type === "bounce",
  };
}

function isInsidePlatform(
  platform: ReturnType<typeof platformTop>,
  position: Vec3,
) {
  return (
    Number.isFinite(platform.y) &&
    Math.abs(position[0] - platform.x) <= platform.halfX &&
    Math.abs(position[2] - platform.z) <= platform.halfZ
  );
}

export type ContactBounds = {
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
};
export type ContactBoundsInput = {
  readonly min: readonly number[];
  readonly max: readonly number[];
};
const contactBounds = new WeakMap<object, ContactBounds>();

function normalizeContactBounds(bounds: ContactBoundsInput): ContactBounds {
  const min = [...bounds.min];
  const max = [...bounds.max];
  if (
    min.length !== 3 ||
    max.length !== 3 ||
    !min.every(Number.isFinite) ||
    !max.every(Number.isFinite) ||
    min.some((value, index) => value > max[index])
  )
    throw new Error("Contact bounds must be finite, ordered 3D extents.");
  return {
    min: min as [number, number, number],
    max: max as [number, number, number],
  };
}

/** Bind renderer-prepared bounds to one immutable geometry recipe identity. */
export function registerContactBounds(
  recipe: object,
  bounds: ContactBoundsInput,
): ContactBounds {
  if (!recipe || typeof recipe !== "object")
    throw new Error("Contact bounds require an object recipe identity.");
  const normalized = normalizeContactBounds(bounds);
  contactBounds.set(recipe, normalized);
  return normalized;
}

/** Broad-phase contact volumes follow rendered geometry, including multipart bounds. */
export function touchesEntity(
  entity: Entity,
  player: Vec3,
  time: number,
  matrix?: Matrix4,
): boolean {
  const recipe = entity.geometry;
  if (entity.stage !== "ready" || !recipe) return false;
  let bounds = contactBounds.get(recipe);
  if (!bounds) {
    if (recipe.kind === "asset")
      bounds = registerContactBounds(
        recipe,
        requireCatalogAsset(recipe.assetId).bounds,
      );
    else if (recipe.kind === "generated") {
      if (recipe.model?.bounds)
        bounds = registerContactBounds(recipe, recipe.model.bounds);
    } else {
      const geometry = entityGeometry(entity);
      geometry.computeBoundingBox();
      const box = geometry.boundingBox;
      if (box)
        bounds = registerContactBounds(recipe, {
          min: box.min.toArray(),
          max: box.max.toArray(),
        });
      geometry.dispose();
    }
    if (!bounds) return false;
    contactBounds.set(recipe, bounds);
  }
  const worldBounds = matrix ? transformBounds(matrix, bounds) : undefined;
  const origin = movingEntityPosition(entity, time);
  return [0, 1, 2].every((axis) => {
    const low =
      worldBounds?.min[axis] ??
      origin[axis] +
        Math.min(
          bounds!.min[axis] * entity.scale[axis],
          bounds!.max[axis] * entity.scale[axis],
        );
    const high =
      worldBounds?.max[axis] ??
      origin[axis] +
        Math.max(
          bounds!.min[axis] * entity.scale[axis],
          bounds!.max[axis] * entity.scale[axis],
        );
    const radius =
      (axis === 1 ? PLAYER_HALF_HEIGHT : CONTACT_HORIZONTAL_TOLERANCE) + 1e-5;
    return player[axis] + radius >= low && player[axis] - radius <= high;
  });
}

export function stepGameplay(
  state: PlayerState,
  input: PlayerInput,
  entities: Entity[],
  collectedBefore: readonly string[],
  time: number,
  delta: number,
  collisionTargets?: ReadonlySet<string>,
  worldMatrices?: ReadonlyMap<string, Matrix4>,
): GameplayStep {
  const dt = Math.min(Math.max(delta, 0), 0.04);
  const position: Vec3 = [...state.position];
  const readyPlatforms = entities.filter(
    (entity) =>
      entity.stage === "ready" &&
      (entity.geometry?.kind === "platform" ||
        (entity.geometry?.kind === "generated" &&
          entity.geometry.collision === "platform" &&
          !!entity.geometry.model) ||
        (entity.geometry?.kind === "asset" &&
          requireCatalogAsset(entity.geometry.assetId).tags.some(
            (tag) => tag === "platform" || tag === "bridge",
          ))),
  );

  // A grounded player inherits the exact displacement of a moving platform.
  // This also makes compatible speed/amplitude edits reconcile without a reset.
  const support = state.groundedOn
    ? readyPlatforms.find((entity) => entity.id === state.groundedOn)
    : undefined;
  const supportPose = support ? worldMatrices?.get(support.id) : undefined;
  const previousSupportPose =
    supportPose && state.supportMatrix?.length === 16
      ? new Matrix4().fromArray(state.supportMatrix)
      : supportPose;
  const beforePosition = support
    ? (state.supportPosition ?? movingEntityPosition(support, time - dt))
    : undefined;
  const supportedBeforeDisplacement = Boolean(
    support &&
    beforePosition &&
    isInsidePlatform(
      platformTop(support, time, beforePosition, previousSupportPose, position),
      position,
    ),
  );
  if (support && beforePosition && supportedBeforeDisplacement) {
    const contact: Vec3 = [
      position[0],
      position[1] - PLAYER_HALF_HEIGHT,
      position[2],
    ];
    const carried =
      supportPose && previousSupportPose
        ? carrySupportContact(previousSupportPose, supportPose, contact)
        : undefined;
    if (carried) {
      position[0] = carried[0];
      position[1] = carried[1] + PLAYER_HALF_HEIGHT;
      position[2] = carried[2];
    } else if (!supportPose) {
      const before = beforePosition;
      const after = movingEntityPosition(support, time);
      position[0] += after[0] - before[0];
      const afterTop = platformTop(support, time).y;
      const beforeTop =
        state.supportTop ?? platformTop(support, time, before).y;
      position[1] += afterTop - beforeTop;
      position[2] += after[2] - before[2];
    }
  }

  const magnitude = Math.hypot(input.x, input.z);
  if (magnitude) {
    position[0] += (input.x / magnitude) * MOVE_SPEED * dt;
    position[2] += (input.z / magnitude) * MOVE_SPEED * dt;
  }

  let velocityY = state.velocityY;
  const supportedAfterDisplacement = Boolean(
    support &&
    supportedBeforeDisplacement &&
    isInsidePlatform(
      platformTop(support, time, undefined, supportPose, position),
      position,
    ),
  );
  let groundedOn = supportedAfterDisplacement ? support?.id : undefined;
  let supportPosition = supportedAfterDisplacement
    ? state.supportPosition
    : undefined;
  let supportTop = supportedAfterDisplacement ? state.supportTop : undefined;
  const wasSupported =
    supportedAfterDisplacement || position[1] <= GROUND_CENTER_Y + 0.04;
  if (input.jump && wasSupported) {
    velocityY = JUMP_SPEED;
    groundedOn = undefined;
    supportPosition = undefined;
    supportTop = undefined;
  }
  velocityY -= GRAVITY * dt;
  if (supportedAfterDisplacement && supportPose && support && !input.jump)
    position[1] = platformTop(
      support,
      time,
      undefined,
      supportPose,
      position,
    ).y;
  const previousY = position[1];
  position[1] += velocityY * dt;

  let floor = GROUND_CENTER_Y;
  let floorId: string | undefined;
  let bounce = false;
  for (const entity of readyPlatforms) {
    const platform = platformTop(
      entity,
      time,
      undefined,
      worldMatrices?.get(entity.id),
      position,
    );
    const inside = isInsidePlatform(platform, position);
    // Only land while descending and crossing a top surface. This avoids
    // teleporting onto a platform when walking below or beside it.
    if (
      inside &&
      velocityY <= 0 &&
      previousY >= platform.y - 0.08 &&
      position[1] <= platform.y &&
      platform.y >= floor
    ) {
      floor = platform.y;
      floorId = platform.id;
      bounce = platform.bounce;
    }
  }
  if (position[1] <= floor) {
    position[1] = floor;
    velocityY = bounce ? JUMP_SPEED * 1.18 : 0;
    groundedOn = bounce ? undefined : floorId;
    supportPosition = floorId
      ? movingEntityPosition(
          readyPlatforms.find((entity) => entity.id === floorId)!,
          time,
        )
      : undefined;
    supportTop = floorId ? floor : undefined;
  } else if (!floorId) {
    groundedOn = undefined;
    supportPosition = undefined;
    supportTop = undefined;
  }

  const radius = Math.hypot(position[0], position[2]);
  if (radius > 8.4) {
    position[0] *= 8.4 / radius;
    position[2] *= 8.4 / radius;
  }

  const collected = [...collectedBefore];
  for (const entity of entities) {
    if (
      entity.behavior?.type === "collect" &&
      touchesEntity(entity, position, time, worldMatrices?.get(entity.id)) &&
      !collected.includes(entity.id)
    )
      collected.push(entity.id);
  }
  const collectibleIds = entities
    .filter(
      (entity) =>
        entity.stage === "ready" && entity.behavior?.type === "collect",
    )
    .map((entity) => entity.id);
  const won = entities.some((entity) => {
    if (entity.stage !== "ready" || entity.behavior?.type !== "portal")
      return false;
    return (
      collectibleIds.every((id) => collected.includes(id)) &&
      touchesEntity(entity, position, time, worldMatrices?.get(entity.id))
    );
  });
  return {
    position,
    velocityY,
    groundedOn,
    supportPosition,
    supportTop,
    supportMatrix: groundedOn
      ? worldMatrices?.get(groundedOn)?.toArray()
      : undefined,
    collected,
    contacts: entities
      .filter(
        (entity) =>
          (collisionTargets === undefined || collisionTargets.has(entity.id)) &&
          !collectedBefore.includes(entity.id) &&
          touchesEntity(entity, position, time, worldMatrices?.get(entity.id)),
      )
      .map((entity) => entity.id),
    won,
  };
}
