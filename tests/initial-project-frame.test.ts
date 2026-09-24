import { describe, expect, it } from "vitest";
import {
  initialProjectFrameSettlement,
  isInitialProjectFrameBuildStart,
  type InitialProjectFrameLifecycle,
  type InitialProjectFrameSettlement,
} from "../src/lib/initial-project-frame";

const landing: InitialProjectFrameLifecycle = {
  projectId: "landing-project",
  phase: "landing",
  building: false,
  entityCount: 0,
};

const firstBuild: InitialProjectFrameLifecycle = {
  projectId: "new-project",
  phase: "descending",
  building: true,
  entityCount: 0,
};

const successfulSettlement: InitialProjectFrameSettlement = {
  projectId: "new-project",
  phase: "editing",
  building: false,
  playing: false,
  hasError: false,
  hasRecovery: false,
  hasCommittedBounds: true,
  userNavigated: false,
};

describe("initial project camera framing", () => {
  it("arms only when a new empty project starts from landing", () => {
    expect(isInitialProjectFrameBuildStart(landing, firstBuild)).toBe(true);
    expect(
      isInitialProjectFrameBuildStart(
        { ...landing, projectId: "new-project" },
        firstBuild,
      ),
    ).toBe(false);
    expect(
      isInitialProjectFrameBuildStart(
        { ...landing, phase: "editing" },
        firstBuild,
      ),
    ).toBe(false);
    expect(
      isInitialProjectFrameBuildStart(landing, {
        ...firstBuild,
        entityCount: 1,
      }),
    ).toBe(false);
  });

  it("waits for a successful settled build with committed bounds", () => {
    expect(
      initialProjectFrameSettlement(
        { projectId: "new-project", userNavigated: false },
        { ...successfulSettlement, building: true },
      ),
    ).toBe("wait");
    expect(
      initialProjectFrameSettlement(
        { projectId: "new-project", userNavigated: false },
        successfulSettlement,
      ),
    ).toBe("frame");
  });

  it("preserves failed, switched, playing, or manually navigated views", () => {
    const attempt = { projectId: "new-project", userNavigated: false };
    for (const current of [
      { ...successfulSettlement, projectId: "another-project" },
      { ...successfulSettlement, phase: "landing" as const },
      { ...successfulSettlement, playing: true },
      { ...successfulSettlement, hasError: true },
      { ...successfulSettlement, hasRecovery: true },
      { ...successfulSettlement, hasCommittedBounds: false },
      { ...successfulSettlement, userNavigated: true },
    ])
      expect(initialProjectFrameSettlement(attempt, current)).toBe("discard");
  });
});
