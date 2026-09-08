import type { Entity } from "./protocol";
import { requireCatalogAsset } from "./asset-catalog";

export type Vec3 = [number, number, number];

export type PlayerState = {
  position: Vec3;
  velocityY: number;
  groundedOn?: string;
  supportPosition?: Vec3;
  supportTop?: number;
};

export type PlayerInput = {
  x: number;
  z: number;
  jump: boolean;
};

export type GameplayStep = PlayerState & {
  collected: string[];
  won: boolean;
};

const GROUND_CENTER_Y = 0.42;
const PLAYER_HALF_HEIGHT = 0.42;
const MOVE_SPEED = 4;
const JUMP_SPEED = 6;
const GRAVITY = 15;

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

function platformTop(entity: Entity, time: number) {
  const position = movingEntityPosition(entity, time);
  if (entity.geometry?.kind === "asset") {
    const { min, max } = requireCatalogAsset(entity.geometry.assetId).bounds;
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
    y: position[1] + 0.52 * entity.scale[1] + PLAYER_HALF_HEIGHT,
    halfX: entity.scale[0] * 0.55,
    halfZ: entity.scale[2] * 0.55,
    bounce: entity.behavior?.type === "bounce",
  };
}

export function stepGameplay(
  state: PlayerState,
  input: PlayerInput,
  entities: Entity[],
  collectedBefore: readonly string[],
  time: number,
  delta: number,
): GameplayStep {
  const dt = Math.min(Math.max(delta, 0), 0.04);
  const position: Vec3 = [...state.position];
  const readyPlatforms = entities.filter(
    (entity) =>
      entity.stage === "ready" &&
      (entity.geometry?.kind === "platform" ||
        (entity.geometry?.kind === "asset" &&
          requireCatalogAsset(entity.geometry.assetId).tags.some(
            (tag) => tag === "platform" || tag === "bridge",
          ))),
  );

  // A grounded player inherits the exact displacement of a moving platform.
  // This also makes compatible speed/amplitude edits reconcile without a reset.
  if (state.groundedOn) {
    const support = readyPlatforms.find(
      (entity) => entity.id === state.groundedOn,
    );
    if (support) {
      const before =
        state.supportPosition ?? movingEntityPosition(support, time - dt);
      const after = movingEntityPosition(support, time);
      position[0] += after[0] - before[0];
      const afterTop = platformTop(support, time).y;
      const beforeTop =
        state.supportTop ??
        before[1] + 0.52 * support.scale[1] + PLAYER_HALF_HEIGHT;
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
  let groundedOn = state.groundedOn;
  let supportPosition = state.supportPosition;
  let supportTop = state.supportTop;
  const wasSupported =
    Boolean(groundedOn) || position[1] <= GROUND_CENTER_Y + 0.04;
  if (input.jump && wasSupported) {
    velocityY = JUMP_SPEED;
    groundedOn = undefined;
    supportPosition = undefined;
    supportTop = undefined;
  }
  velocityY -= GRAVITY * dt;
  const previousY = position[1];
  position[1] += velocityY * dt;

  let floor = GROUND_CENTER_Y;
  let floorId: string | undefined;
  let bounce = false;
  for (const entity of readyPlatforms) {
    const platform = platformTop(entity, time);
    const inside =
      Math.abs(position[0] - platform.x) <= platform.halfX &&
      Math.abs(position[2] - platform.z) <= platform.halfZ;
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
    if (entity.stage !== "ready") continue;
    const entityPosition = movingEntityPosition(entity, time);
    const distance = Math.hypot(
      position[0] - entityPosition[0],
      position[2] - entityPosition[2],
    );
    if (
      entity.behavior?.type === "collect" &&
      distance < 0.85 &&
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
    const portal = movingEntityPosition(entity, time);
    return (
      collectibleIds.every((id) => collected.includes(id)) &&
      Math.hypot(position[0] - portal[0], position[2] - portal[2]) < 1.2
    );
  });
  return {
    position,
    velocityY,
    groundedOn,
    supportPosition,
    supportTop,
    collected,
    won,
  };
}
