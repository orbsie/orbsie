import { beforeEach, expect, it, vi } from "vitest";
import {
  beginExperience,
  finishExperience,
  getExperienceMetrics,
  hasExperienceMilestone,
  markSceneUpdateDraw,
  markExperience,
  markVisibleSeed,
  noteSceneUpdate,
  noteReservation,
} from "../src/lib/experience-metrics";

let clock: ReturnType<typeof vi.fn>;
let projectNumber = 0;

beforeEach(() => {
  clock = vi.fn(() => 1000);
  vi.stubGlobal("performance", { now: clock });
  projectNumber += 1;
});

function projectId(label: string) {
  return `experience-test-${projectNumber}-${label}`;
}

it("records each milestone at its first monotonic time relative to submission", () => {
  const id = projectId("first-write");
  const token = beginExperience(id);
  clock.mockReturnValue(1012);
  markExperience(id, "controls", token);
  clock.mockReturnValue(1008);
  markExperience(id, "controls", token);
  clock.mockReturnValue(1020);
  noteReservation(id, "tree", token);
  clock.mockReturnValue(1032);
  markVisibleSeed(id, "tree");

  const [metrics] = getExperienceMetrics(id);
  expect(metrics.milestones).toEqual({
    submission: 0,
    reservation: 20,
    visibleSeed: 32,
    controls: 12,
    objective: null,
    generationComplete: null,
    publishReady: null,
  });
  expect(metrics.reservations).toEqual([{ entityId: "tree", at: 20 }]);
  expect(hasExperienceMilestone(id, "controls")).toBe(true);
});

it("keeps stale tokens from writing the newer run", () => {
  const id = projectId("stale");
  const stale = beginExperience(id);
  noteReservation(id, "old", stale);
  const current = beginExperience(id);
  markExperience(id, "controls", stale);
  noteReservation(id, "old", stale);
  finishExperience(id, stale, "error");
  markExperience(id, "controls", current);

  const [metrics] = getExperienceMetrics(id);
  expect(metrics.token).toBe(current);
  expect(metrics.milestones.controls).toBe(0);
  expect(metrics.reservations).toEqual([]);
  expect(metrics.outcome).toBeNull();
});

it("retains only the latest twenty runs", () => {
  const ids = Array.from({ length: 21 }, (_, index) =>
    projectId(`bounded-${index}`),
  );
  ids.forEach((id) => beginExperience(id));

  const metrics = getExperienceMetrics();
  expect(metrics).toHaveLength(20);
  expect(metrics.map((run) => run.projectId)).toEqual(ids.slice(1).reverse());
});

it("returns defensive snapshots", () => {
  const id = projectId("copy");
  const token = beginExperience(id);
  noteReservation(id, "tree", token);
  const snapshot = getExperienceMetrics(id)[0];
  snapshot.milestones.controls = 99;
  snapshot.reservations[0].entityId = "changed";
  snapshot.reservations.push({ entityId: "new", at: 1 });

  expect(hasExperienceMilestone(id, "controls")).toBe(false);
  expect(hasExperienceMilestone("missing-project", "controls")).toBe(false);
  expect(getExperienceMetrics(id)[0].reservations).toEqual([
    { entityId: "tree", at: 0 },
  ]);
});

it("keeps scene draws tied to the exact entity object", () => {
  const id = projectId("scene-identity");
  const token = beginExperience(id);
  const oldEntity = { id: "same" };
  const currentEntity = { id: "same" };

  clock.mockReturnValue(1010);
  noteSceneUpdate(id, oldEntity, token);
  clock.mockReturnValue(1020);
  noteSceneUpdate(id, currentEntity, token);
  clock.mockReturnValue(1030);
  markSceneUpdateDraw(id, oldEntity);

  expect(getExperienceMetrics(id)[0].sceneUpdates).toEqual([
    { entityId: "same", acceptedAt: 10, drawnAt: 30, latencyMs: 20 },
    { entityId: "same", acceptedAt: 20, drawnAt: null, latencyMs: null },
  ]);

  clock.mockReturnValue(1040);
  markSceneUpdateDraw(id, currentEntity);
  expect(getExperienceMetrics(id)[0].sceneUpdates[1]).toEqual({
    entityId: "same",
    acceptedAt: 20,
    drawnAt: 40,
    latencyMs: 20,
  });
});

it("ignores stale scene tokens and callbacks from an older run", () => {
  const id = projectId("scene-stale");
  const stale = beginExperience(id);
  const oldEntity = { id: "same" };
  noteSceneUpdate(id, oldEntity, stale);
  const current = beginExperience(id);
  const currentEntity = { id: "same" };

  noteSceneUpdate(id, currentEntity, stale);
  markSceneUpdateDraw(id, oldEntity);

  expect(getExperienceMetrics(id)[0]).toMatchObject({
    token: current,
    sceneUpdates: [],
  });
});

it("records only the first scene draw with monotonic latency", () => {
  const id = projectId("scene-first-draw");
  const token = beginExperience(id);
  const entity = { id: "tree" };
  clock.mockReturnValue(1012);
  noteSceneUpdate(id, entity, token);
  clock.mockReturnValue(1008);
  markSceneUpdateDraw(id, entity);
  clock.mockReturnValue(1032);
  markSceneUpdateDraw(id, entity);

  expect(getExperienceMetrics(id)[0].sceneUpdates).toEqual([
    { entityId: "tree", acceptedAt: 12, drawnAt: 12, latencyMs: 0 },
  ]);
});

it("keeps only the latest scene samples and copies them defensively", () => {
  const id = projectId("scene-cap");
  const token = beginExperience(id);
  for (let index = 0; index < 257; index++) {
    clock.mockReturnValue(1001 + index);
    noteSceneUpdate(id, { id: `entity-${index}` }, token);
  }

  const snapshot = getExperienceMetrics(id)[0];
  expect(snapshot.sceneUpdates).toHaveLength(256);
  expect(snapshot.sceneUpdates[0]).toEqual({
    entityId: "entity-1",
    acceptedAt: 2,
    drawnAt: null,
    latencyMs: null,
  });
  snapshot.sceneUpdates[0].entityId = "changed";
  snapshot.sceneUpdates.push({
    entityId: "extra",
    acceptedAt: 0,
    drawnAt: 0,
    latencyMs: 0,
  });

  expect(getExperienceMetrics(id)[0].sceneUpdates[0]).toEqual({
    entityId: "entity-1",
    acceptedAt: 2,
    drawnAt: null,
    latencyMs: null,
  });
  expect(getExperienceMetrics(id)[0].sceneUpdates).toHaveLength(256);
});

it.each(["error", "cancelled"] as const)(
  "does not report generation complete on %s",
  (outcome) => {
    const id = projectId(outcome);
    const token = beginExperience(id);
    finishExperience(id, token, outcome);
    const [metrics] = getExperienceMetrics(id);
    expect(metrics.milestones.generationComplete).toBeNull();
    expect(metrics.outcome).toBe(outcome);
  },
);
