import { beforeEach, expect, it, vi } from "vitest";
import {
  beginExperience,
  finishExperience,
  getExperienceMetrics,
  hasExperienceMilestone,
  markExperience,
  markVisibleSeed,
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
