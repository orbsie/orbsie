import type { WorldNavigationVec3 } from "./world-navigation";

export const DEFAULT_FORMATION_RESIDENT_CAP = 48;
export const DEFAULT_FORMATION_RESIDENCY_RADIUS = 256;
export const DEFAULT_FORMATION_RESIDENCY_HYSTERESIS = 64;

export type FormationResidencyCandidate = Readonly<{
  id: string;
  stage: "seed" | "coarse" | "ready";
  /** Resolved world-space center, including any parent-group transforms. */
  worldCenter?: WorldNavigationVec3;
}>;

export type FormationResidencyReason =
  | "resident-selected"
  | "resident-visible"
  | "resident-retained"
  | "resident-near"
  | "placeholder-invalid-center"
  | "placeholder-outside-radius"
  | "placeholder-capacity"
  | "not-ready";

export type FormationResidencyOptions = Readonly<{
  candidates: readonly FormationResidencyCandidate[];
  focus: WorldNavigationVec3;
  visibleIds?: ReadonlySet<string>;
  selectedIds?: ReadonlySet<string>;
  previousResidentIds?: ReadonlySet<string>;
  maxResidents?: number;
  radius?: number;
  hysteresisDistance?: number;
}>;

export type FormationResidencySelection = Readonly<{
  /** Ready entities that should keep their full mesh, texture, and asset lease. */
  residentIds: ReadonlySet<string>;
  /** Ready entities that can use a lightweight renderer placeholder. */
  placeholderIds: ReadonlySet<string>;
  /** Includes `not-ready` entries so the caller can keep forming work separate. */
  reasonById: ReadonlyMap<string, FormationResidencyReason>;
  capacity: number;
  readyCount: number;
  residentCount: number;
  placeholderCount: number;
  invalidCenterCount: number;
  focusValid: boolean;
}>;

type ScoredCandidate = {
  id: string;
  distance: number;
  priority: 0 | 1 | 2;
  wasResident: boolean;
  effectiveDistance: number;
};

const FALLBACK_FOCUS: WorldNavigationVec3 = [0, 0, 0];
const MAX_OPTION_DISTANCE = 1_000_000_000;

function finiteVec3(value: unknown): value is WorldNavigationVec3 {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((component) => Number.isFinite(component))
  );
}

function nonnegativeOption(
  value: number | undefined,
  fallback: number,
): number {
  if (value === undefined) return fallback;
  return Number.isFinite(value) && value >= 0
    ? Math.min(value, MAX_OPTION_DISTANCE)
    : fallback;
}

function residentCap(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value))
    return DEFAULT_FORMATION_RESIDENT_CAP;
  return Math.max(0, Math.floor(Math.min(value, Number.MAX_SAFE_INTEGER)));
}

function lexicalCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Selects a stable, bounded set of ready formations for full renderer resources.
 * Non-ready entities are reported separately and never consume this budget.
 */
export function selectFormationResidents(
  options: FormationResidencyOptions,
): FormationResidencySelection {
  const focusValid = finiteVec3(options.focus);
  const focus = focusValid ? options.focus : FALLBACK_FOCUS;
  const capacity = residentCap(options.maxResidents);
  const radius = nonnegativeOption(
    options.radius,
    DEFAULT_FORMATION_RESIDENCY_RADIUS,
  );
  const hysteresis = nonnegativeOption(
    options.hysteresisDistance,
    DEFAULT_FORMATION_RESIDENCY_HYSTERESIS,
  );
  const outerRadius = Math.min(MAX_OPTION_DISTANCE, radius + hysteresis);
  const residentIds = new Set<string>();
  const placeholderIds = new Set<string>();
  const reasonById = new Map<string, FormationResidencyReason>();
  const scored: ScoredCandidate[] = [];
  let readyCount = 0;
  let invalidCenterCount = 0;

  for (const candidate of options.candidates) {
    if (candidate.stage !== "ready") {
      reasonById.set(candidate.id, "not-ready");
      continue;
    }
    readyCount += 1;
    if (!finiteVec3(candidate.worldCenter)) {
      invalidCenterCount += 1;
      reasonById.set(candidate.id, "placeholder-invalid-center");
      placeholderIds.add(candidate.id);
      continue;
    }
    const distance = Math.hypot(
      candidate.worldCenter[0] - focus[0],
      candidate.worldCenter[1] - focus[1],
      candidate.worldCenter[2] - focus[2],
    );
    if (!Number.isFinite(distance)) {
      invalidCenterCount += 1;
      reasonById.set(candidate.id, "placeholder-invalid-center");
      placeholderIds.add(candidate.id);
      continue;
    }

    const selected = options.selectedIds?.has(candidate.id) === true;
    const visible = options.visibleIds?.has(candidate.id) === true;
    const wasResident = options.previousResidentIds?.has(candidate.id) === true;
    if (
      !selected &&
      !visible &&
      distance > radius &&
      !(wasResident && distance <= outerRadius)
    ) {
      reasonById.set(candidate.id, "placeholder-outside-radius");
      placeholderIds.add(candidate.id);
      continue;
    }

    scored.push({
      id: candidate.id,
      distance,
      priority: selected ? 0 : visible ? 1 : 2,
      wasResident,
      effectiveDistance: Math.max(0, distance - (wasResident ? hysteresis : 0)),
    });
  }

  scored.sort(
    (left, right) =>
      left.priority - right.priority ||
      left.effectiveDistance - right.effectiveDistance ||
      Number(right.wasResident) - Number(left.wasResident) ||
      left.distance - right.distance ||
      lexicalCompare(left.id, right.id),
  );

  for (const candidate of scored) {
    if (residentIds.size < capacity) {
      residentIds.add(candidate.id);
      reasonById.set(
        candidate.id,
        candidate.priority === 0
          ? "resident-selected"
          : candidate.priority === 1
            ? "resident-visible"
            : candidate.wasResident
              ? "resident-retained"
              : "resident-near",
      );
    } else {
      placeholderIds.add(candidate.id);
      reasonById.set(candidate.id, "placeholder-capacity");
    }
  }

  // Map/Set iteration remains deterministic even if the input candidate order changes.
  const sortedReasons = new Map(
    [...reasonById.entries()].sort(([left], [right]) =>
      lexicalCompare(left, right),
    ),
  );
  const sortedPlaceholders = new Set([...placeholderIds].sort(lexicalCompare));

  return {
    residentIds,
    placeholderIds: sortedPlaceholders,
    reasonById: sortedReasons,
    capacity,
    readyCount,
    residentCount: residentIds.size,
    placeholderCount: sortedPlaceholders.size,
    invalidCenterCount,
    focusValid,
  };
}
