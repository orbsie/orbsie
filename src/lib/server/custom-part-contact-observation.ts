import type { Entity, Project } from "../protocol";

const MAX_OBSERVED_ENTITIES = 3;

type Bounds = {
  x: readonly [number, number];
  y: readonly [number, number];
  z: readonly [number, number];
};

type PartObservation = {
  index: number;
  shape: string;
  bounds: Bounds;
  volume: number;
};

type InconclusiveReason =
  | "parent-transform"
  | "entity-rotation"
  | "part-rotation"
  | "unsupported-part-shape"
  | "insufficient-volumetric-parts"
  | "invalid-transform";

function finiteVector(
  value: unknown,
): value is readonly [number, number, number] {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((component) => Number.isFinite(component))
  );
}

function zeroRotation(rotation: unknown) {
  return (
    rotation === undefined ||
    (finiteVector(rotation) && rotation.every((component) => component === 0))
  );
}

type SupportedShape =
  "box" | "sphere" | "cone" | "cylinder" | "torus" | "lathe";

function shapeBounds(
  part: unknown,
): { bounds: Bounds; shape: SupportedShape; localVolume: number } | undefined {
  if (!part || typeof part !== "object") return undefined;
  const candidate = part as {
    shape?: unknown;
    position?: unknown;
    scale?: unknown;
    rotation?: unknown;
    profile?: unknown;
  };
  if (
    typeof candidate.shape !== "string" ||
    !finiteVector(candidate.position) ||
    !finiteVector(candidate.scale)
  )
    return undefined;
  if (!zeroRotation(candidate.rotation)) return undefined;
  const position = candidate.position;
  const scale = candidate.scale;

  let unit: Bounds;
  let shape: SupportedShape;
  let primitiveVolume: number;
  switch (candidate.shape) {
    case "box":
      shape = candidate.shape;
      primitiveVolume = 1;
      unit = { x: [-0.5, 0.5], y: [-0.5, 0.5], z: [-0.5, 0.5] };
      break;
    case "cone":
    case "cylinder":
      shape = candidate.shape;
      primitiveVolume = Math.PI * (candidate.shape === "cone" ? 1 / 3 : 1);
      unit = { x: [-1, 1], y: [-0.5, 0.5], z: [-1, 1] };
      break;
    case "sphere":
      shape = candidate.shape;
      primitiveVolume = (4 / 3) * Math.PI;
      unit = { x: [-1, 1], y: [-1, 1], z: [-1, 1] };
      break;
    case "torus":
      // Three.js TorusGeometry lies in XY with its tube extending along Z.
      shape = candidate.shape;
      primitiveVolume = 2 * Math.PI ** 2 * 0.7 * 0.25 ** 2;
      unit = { x: [-0.95, 0.95], y: [-0.95, 0.95], z: [-0.25, 0.25] };
      break;
    case "lathe": {
      shape = candidate.shape;
      if (
        !Array.isArray(candidate.profile) ||
        candidate.profile.length < 2 ||
        candidate.profile.some(
          (point) =>
            !Array.isArray(point) ||
            point.length !== 2 ||
            !point.every((component) => Number.isFinite(component)),
        )
      )
        return undefined;
      const profile = candidate.profile as [number, number][];
      const radii = profile.map((point) => point[0]);
      const heights = profile.map((point) => point[1]);
      const radius = Math.max(...radii);
      // Profiles are piecewise linear, so sum their frustum segment volumes.
      let profileVolume = 0;
      for (let index = 1; index < profile.length; index++) {
        const [previousRadius, previousHeight] = profile[index - 1];
        const [currentRadius, currentHeight] = profile[index];
        const height = Math.abs(currentHeight - previousHeight);
        profileVolume +=
          (Math.PI *
            height *
            (previousRadius ** 2 +
              previousRadius * currentRadius +
              currentRadius ** 2)) /
          3;
      }
      primitiveVolume = profileVolume;
      unit = {
        x: [-radius, radius],
        y: [Math.min(...heights), Math.max(...heights)],
        z: [-radius, radius],
      };
      break;
    }
    default:
      return undefined;
  }

  const axisBounds = (
    interval: readonly [number, number],
    offset: number,
    scale: number,
  ): [number, number] => {
    const first = offset + interval[0] * scale;
    const second = offset + interval[1] * scale;
    return [Math.min(first, second), Math.max(first, second)];
  };
  const bounds = {
    x: axisBounds(unit.x, position[0], scale[0]),
    y: axisBounds(unit.y, position[1], scale[1]),
    z: axisBounds(unit.z, position[2], scale[2]),
  };
  if (
    Object.values(bounds).some((interval) => !interval.every(Number.isFinite))
  )
    return undefined;
  const localVolume =
    primitiveVolume * Math.abs(scale[0] * scale[1] * scale[2]);
  if (!Number.isFinite(localVolume) || localVolume <= 0) return undefined;
  return { bounds, shape, localVolume };
}

function partObservations(entity: Entity): {
  parts: PartObservation[];
  reason?: InconclusiveReason;
} {
  const geometry = entity.geometry;
  if (
    geometry?.kind !== "custom" ||
    !Array.isArray(geometry.parts) ||
    geometry.parts.length < 2
  )
    return { parts: [], reason: "insufficient-volumetric-parts" };
  if (entity.parentId) return { parts: [], reason: "parent-transform" };
  if (!zeroRotation(entity.rotation))
    return { parts: [], reason: "entity-rotation" };
  if (
    !finiteVector(entity.position) ||
    !finiteVector(entity.scale) ||
    entity.scale.some((component) => component === 0)
  )
    return { parts: [], reason: "invalid-transform" };

  const supported: PartObservation[] = [];
  let unsupportedShape = false;
  for (const [index, part] of geometry.parts.entries()) {
    if (
      part &&
      typeof part === "object" &&
      "rotation" in part &&
      !zeroRotation(part.rotation)
    )
      return { parts: [], reason: "part-rotation" };
    const local = shapeBounds(part);
    if (!local) {
      if (part && typeof part === "object" && "shape" in part)
        unsupportedShape = true;
      continue;
    }
    const { bounds: localBounds, shape, localVolume } = local;
    const worldBounds = {
      x: localBounds.x.map(
        (value) => entity.position[0] + value * entity.scale[0],
      ) as [number, number],
      y: localBounds.y.map(
        (value) => entity.position[1] + value * entity.scale[1],
      ) as [number, number],
      z: localBounds.z.map(
        (value) => entity.position[2] + value * entity.scale[2],
      ) as [number, number],
    };
    for (const axis of ["x", "y", "z"] as const)
      worldBounds[axis].sort((left, right) => left - right);
    const volume =
      localVolume *
      Math.abs(entity.scale[0] * entity.scale[1] * entity.scale[2]);
    if (!Number.isFinite(volume) || volume <= 0) continue;
    supported.push({ index, shape, bounds: worldBounds, volume });
  }

  supported.sort(
    (left, right) => right.volume - left.volume || left.index - right.index,
  );
  if (supported.length < 2)
    return {
      parts: supported,
      reason: unsupportedShape
        ? "unsupported-part-shape"
        : "insufficient-volumetric-parts",
    };
  return { parts: supported.slice(0, 2) };
}

function roundedGap(parts: readonly PartObservation[]) {
  const [first, second] = parts;
  const firstTop = first.bounds.y[1];
  const firstBottom = first.bounds.y[0];
  const secondTop = second.bounds.y[1];
  const secondBottom = second.bounds.y[0];
  const gap = Math.max(
    0,
    Math.max(firstBottom, secondBottom) - Math.min(firstTop, secondTop),
  );
  return Math.round(gap * 1000) / 1000;
}

/**
 * Computes a bounded vertical-bounds advisory for ready, root-level custom
 * geometry whose entity and part rotations are all zero. A zero gap means only
 * that the two largest part bounds touch or overlap on Y; it is not proof of
 * physical surface contact.
 */
export function observeCustomPartContact(
  project: Project,
  selectedEntityId?: string,
) {
  const eligible = project.entities.filter(
    (entity) =>
      entity.stage === "ready" &&
      entity.geometry?.kind === "custom" &&
      Array.isArray(entity.geometry.parts) &&
      entity.geometry.parts.length >= 2,
  );
  eligible.sort((left, right) => {
    if (left.id === selectedEntityId) return -1;
    if (right.id === selectedEntityId) return 1;
    return 0;
  });

  const observations = eligible
    .slice(0, MAX_OBSERVED_ENTITIES)
    .map((entity) => {
      const result = partObservations(entity);
      if (result.parts.length < 2) {
        return {
          entityId: entity.id,
          status: "inconclusive" as const,
          reason: result.reason ?? "insufficient-volumetric-parts",
        };
      }
      return {
        entityId: entity.id,
        status: "observed" as const,
        parts: result.parts.map(({ index, shape }) => ({ index, shape })),
        gapMeters: roundedGap(result.parts),
      };
    });

  return {
    version: 1,
    scope: "largest-two-volume-ready-root-unrotated-custom-entities-y-bounds",
    observations,
  };
}
