import type { Entity } from "./protocol";
import {
  selectFormationResidents,
  type FormationResidencySelection,
} from "./formation-residency";
import type { WorldNavigationVec3 } from "./world-navigation";
import type { WorldNavigationBounds } from "./world-navigation";

export type FormationProxyVisualBounds = Readonly<{
  center: WorldNavigationVec3;
  size: WorldNavigationVec3;
}>;

export type FormationProxyResolvedNode = Readonly<{
  worldMatrix: Readonly<{ elements: readonly number[] }>;
  worldPosition: WorldNavigationVec3;
}>;

export type FormationProxyReviewSnapshot = Readonly<{
  ready: boolean;
  pending: boolean;
  failed: false;
  renderedRevision: number;
}>;

/** Offscreen completed proxies need no draw; visible ones wait for this revision. */
export function formationProxyReviewSnapshot(
  currentRevision: number,
  drawnRevision: number | undefined,
  visible: boolean,
): FormationProxyReviewSnapshot {
  const ready = !visible || drawnRevision === currentRevision;
  return {
    ready,
    pending: !ready,
    failed: false,
    renderedRevision: ready ? currentRevision : (drawnRevision ?? -1),
  };
}

/**
 * Place a proxy from resolved world-space AABB data. If geometry bounds are
 * unavailable, conservatively bound a unit proxy by the resolved affine
 * transform's axis extents, including rotation, scale, and shear.
 */
export function formationProxyVisualBounds(
  bounds: WorldNavigationBounds | undefined,
  sceneNode: FormationProxyResolvedNode | undefined,
): FormationProxyVisualBounds | undefined {
  if (
    bounds &&
    Array.isArray(bounds.min) &&
    bounds.min.length === 3 &&
    Array.isArray(bounds.max) &&
    bounds.max.length === 3 &&
    bounds.min.every(Number.isFinite) &&
    bounds.max.every(Number.isFinite) &&
    bounds.min.every((value, axis) => value <= bounds.max[axis])
  ) {
    const size = bounds.min.map((value, axis) =>
      Math.max(0.12, bounds.max[axis] - value),
    ) as unknown as WorldNavigationVec3;
    const center = bounds.min.map(
      (value, axis) => value + (bounds.max[axis] - value) / 2,
    ) as unknown as WorldNavigationVec3;
    if ([...center, ...size].every(Number.isFinite)) return { center, size };
  }

  const matrix = sceneNode?.worldMatrix.elements;
  const center = sceneNode?.worldPosition;
  if (
    !matrix ||
    matrix.length < 16 ||
    !matrix.every(Number.isFinite) ||
    !Array.isArray(center) ||
    center.length !== 3 ||
    !center.every(Number.isFinite)
  )
    return undefined;
  const size: WorldNavigationVec3 = [
    2 *
      Math.max(
        0.75,
        Math.abs(matrix[0]) + Math.abs(matrix[4]) + Math.abs(matrix[8]),
      ),
    2 *
      Math.max(
        0.75,
        Math.abs(matrix[1]) + Math.abs(matrix[5]) + Math.abs(matrix[9]),
      ),
    2 *
      Math.max(
        0.75,
        Math.abs(matrix[2]) + Math.abs(matrix[6]) + Math.abs(matrix[10]),
      ),
  ];
  return [...center, ...size].every(Number.isFinite)
    ? { center, size }
    : undefined;
}

export const PLAYBACK_RESIDENCY_HORIZONTAL_CELL = 128;
export const PLAYBACK_RESIDENCY_VERTICAL_CELL = 16;

/** Coarse focus changes keep playback residency selection off the frame loop. */
export function playbackFormationResidencyFocusCell(
  position: WorldNavigationVec3,
): { key: string; focus: WorldNavigationVec3 } {
  const finitePosition =
    Array.isArray(position) &&
    position.length === 3 &&
    position.every(Number.isFinite)
      ? position
      : ([0, 0.5, 5] as const);
  const xCell = Math.floor(
    finitePosition[0] / PLAYBACK_RESIDENCY_HORIZONTAL_CELL,
  );
  const yCell = Math.floor(
    finitePosition[1] / PLAYBACK_RESIDENCY_VERTICAL_CELL,
  );
  const zCell = Math.floor(
    finitePosition[2] / PLAYBACK_RESIDENCY_HORIZONTAL_CELL,
  );
  return {
    key: `${xCell}:${yCell}:${zCell}`,
    focus: [
      (xCell + 0.5) * PLAYBACK_RESIDENCY_HORIZONTAL_CELL,
      (yCell + 0.5) * PLAYBACK_RESIDENCY_VERTICAL_CELL,
      (zCell + 0.5) * PLAYBACK_RESIDENCY_HORIZONTAL_CELL,
    ],
  };
}

export type FormationResidencyPresentationCandidate = Readonly<{
  id: string;
  stage: Entity["stage"];
  recipeIdentity: string;
  completedRecipeIdentity?: string;
  /** A resolved, finite world-space center is required to place a proxy. */
  worldCenter?: WorldNavigationVec3;
}>;

export type FormationResidencyPresentationOptions = Readonly<{
  candidates: readonly FormationResidencyPresentationCandidate[];
  focus: WorldNavigationVec3;
  visibleIds?: ReadonlySet<string>;
  selectedId?: string;
  previousResidentIds?: ReadonlySet<string>;
  maxResidents?: number;
  enabled?: boolean;
}>;

export type FormationResidencyPresentation = Readonly<{
  /** Formations that must stay mounted, including pending and unknown bounds. */
  fullFormationIds: ReadonlySet<string>;
  /** Completed, nonresident entities represented by cheap renderer proxies. */
  proxyIds: ReadonlySet<string>;
  /** Completed recipes admitted to the bounded full-resource budget. */
  residentIds: ReadonlySet<string>;
  selection: FormationResidencySelection;
}>;

const EMPTY_SELECTION = selectFormationResidents({
  candidates: [],
  focus: [0, 0, 0],
});

/**
 * Applies the residency budget only to ready, completed recipes with a usable
 * proxy center. Every other entity stays on the full Formation path.
 */
export function selectFormationResidencyPresentation(
  options: FormationResidencyPresentationOptions,
): FormationResidencyPresentation {
  const fullFormationIds = new Set<string>();
  const eligible: FormationResidencyPresentationCandidate[] = [];

  for (const candidate of options.candidates) {
    const hasFiniteCenter =
      Array.isArray(candidate.worldCenter) &&
      candidate.worldCenter.length === 3 &&
      candidate.worldCenter.every(Number.isFinite);
    if (
      !options.enabled ||
      candidate.stage !== "ready" ||
      candidate.completedRecipeIdentity !== candidate.recipeIdentity ||
      !hasFiniteCenter
    ) {
      fullFormationIds.add(candidate.id);
      continue;
    }
    eligible.push(candidate);
  }

  if (!options.enabled) {
    return {
      fullFormationIds,
      proxyIds: new Set(),
      residentIds: new Set(),
      selection: EMPTY_SELECTION,
    };
  }

  const selection = selectFormationResidents({
    candidates: eligible.map(({ id, stage, worldCenter }) => ({
      id,
      stage,
      worldCenter,
    })),
    focus: options.focus,
    visibleIds: options.visibleIds,
    selectedIds: options.selectedId ? new Set([options.selectedId]) : undefined,
    previousResidentIds: options.previousResidentIds,
    maxResidents: options.maxResidents,
  });
  for (const id of selection.residentIds) fullFormationIds.add(id);

  return {
    fullFormationIds,
    proxyIds: selection.placeholderIds,
    residentIds: selection.residentIds,
    selection,
  };
}
