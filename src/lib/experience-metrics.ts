export const EXPERIENCE_MILESTONES = [
  "submission",
  "reservation",
  "visibleSeed",
  "controls",
  "objective",
  "generationComplete",
  "publishReady",
] as const;

export type ExperienceMilestone = (typeof EXPERIENCE_MILESTONES)[number];
export type ExperienceOutcome = "success" | "error" | "cancelled";

export type ExperienceReservation = {
  entityId: string;
  at: number;
};

export type ExperienceSceneUpdate = {
  entityId: string;
  acceptedAt: number;
  drawnAt: number | null;
  latencyMs: number | null;
};

export type ExperienceMetricsSnapshot = {
  projectId: string;
  token: string;
  milestones: Record<ExperienceMilestone, number | null>;
  reservations: ExperienceReservation[];
  sceneUpdates: ExperienceSceneUpdate[];
  outcome: ExperienceOutcome | null;
  finishedAt: number | null;
};

const MAX_RUNS = 20;
const MAX_RESERVATIONS = 160;
const MAX_SCENE_UPDATES = 256;

type SceneEntity = { id: string };

type Run = {
  projectId: string;
  token: string;
  startedAt: number;
  lastElapsed: number;
  milestones: Record<ExperienceMilestone, number | null>;
  reservations: Map<string, number>;
  sceneUpdates: ExperienceSceneUpdate[];
  pendingSceneUpdates: WeakMap<SceneEntity, ExperienceSceneUpdate>;
  outcome?: ExperienceOutcome;
  finishedAt?: number;
};

const runs: Run[] = [];
const currentRuns = new Map<string, Run>();
let tokenSequence = 0;

function now() {
  const clock = globalThis.performance?.now;
  const value =
    typeof clock === "function" ? clock.call(globalThis.performance) : 0;
  return Number.isFinite(value) ? value : 0;
}

function elapsed(run: Run) {
  // performance.now() is monotonic in supported runtimes. Clamping also keeps
  // this invariant when a test replaces the clock with an imperfect stub.
  run.lastElapsed = Math.max(
    run.lastElapsed,
    Math.max(0, now() - run.startedAt),
  );
  return run.lastElapsed;
}

function newToken() {
  const randomUUID = globalThis.crypto?.randomUUID;
  if (typeof randomUUID === "function")
    return randomUUID.call(globalThis.crypto);
  tokenSequence += 1;
  return `experience-${tokenSequence}`;
}

function emptyMilestones(): Record<ExperienceMilestone, number | null> {
  return {
    submission: null,
    reservation: null,
    visibleSeed: null,
    controls: null,
    objective: null,
    generationComplete: null,
    publishReady: null,
  };
}

function currentRun(projectId: string, token?: string) {
  const run = currentRuns.get(projectId);
  return run && (!token || run.token === token) ? run : undefined;
}

function recordMilestone(run: Run, milestone: ExperienceMilestone) {
  if (run.milestones[milestone] === null)
    run.milestones[milestone] = elapsed(run);
}

export function beginExperience(projectId: string): string {
  const run: Run = {
    projectId,
    token: newToken(),
    startedAt: now(),
    lastElapsed: 0,
    milestones: emptyMilestones(),
    reservations: new Map(),
    sceneUpdates: [],
    pendingSceneUpdates: new WeakMap(),
  };
  run.milestones.submission = 0;
  runs.unshift(run);
  currentRuns.set(projectId, run);

  while (runs.length > MAX_RUNS) {
    const removed = runs.pop()!;
    if (currentRuns.get(removed.projectId) === removed)
      currentRuns.delete(removed.projectId);
  }
  return run.token;
}

export function markExperience(
  projectId: string,
  milestone: ExperienceMilestone,
  token?: string,
) {
  const run = currentRun(projectId, token);
  if (run) recordMilestone(run, milestone);
}

export function noteReservation(
  projectId: string,
  entityId: string,
  token: string,
) {
  const run = currentRun(projectId, token);
  if (!run || run.reservations.has(entityId)) return;
  if (run.reservations.size >= MAX_RESERVATIONS) return;
  const at = elapsed(run);
  run.reservations.set(entityId, at);
  if (run.milestones.reservation === null) run.milestones.reservation = at;
}

export function markVisibleSeed(projectId: string, entityId: string) {
  const run = currentRun(projectId);
  if (run?.reservations.has(entityId)) recordMilestone(run, "visibleSeed");
}

export function noteSceneUpdate(
  projectId: string,
  entity: SceneEntity,
  token: string,
) {
  const run = currentRun(projectId, token);
  if (!run) return;

  const sample: ExperienceSceneUpdate = {
    entityId: entity.id,
    acceptedAt: elapsed(run),
    drawnAt: null,
    latencyMs: null,
  };
  run.sceneUpdates.push(sample);
  if (run.sceneUpdates.length > MAX_SCENE_UPDATES) run.sceneUpdates.shift();
  run.pendingSceneUpdates.set(entity, sample);
}

export function markSceneUpdateDraw(projectId: string, entity: SceneEntity) {
  const run = currentRun(projectId);
  const sample = run?.pendingSceneUpdates.get(entity);
  if (!run || !sample || sample.drawnAt !== null) return;

  const drawnAt = elapsed(run);
  sample.drawnAt = drawnAt;
  sample.latencyMs = Math.max(0, drawnAt - sample.acceptedAt);
}

export function finishExperience(
  projectId: string,
  token: string,
  outcome?: ExperienceOutcome,
) {
  const run = currentRun(projectId, token);
  if (!run || outcome === undefined || run.outcome !== undefined) return;
  run.outcome = outcome;
  run.finishedAt = elapsed(run);
}

export function hasExperienceMilestone(
  projectId: string,
  milestone: ExperienceMilestone,
) {
  return currentRuns.get(projectId)?.milestones[milestone] != null;
}

export function getExperienceMetrics(
  projectId?: string,
): ExperienceMetricsSnapshot[] {
  return runs
    .filter((run) => projectId === undefined || run.projectId === projectId)
    .map((run) => ({
      projectId: run.projectId,
      token: run.token,
      milestones: { ...run.milestones },
      reservations: [...run.reservations].map(([entityId, at]) => ({
        entityId,
        at,
      })),
      sceneUpdates: run.sceneUpdates.map((sample) => ({ ...sample })),
      outcome: run.outcome ?? null,
      finishedAt: run.finishedAt ?? null,
    }));
}
