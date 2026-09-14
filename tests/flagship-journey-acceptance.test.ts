import { describe, expect, it } from "vitest";
import { flagshipJourneyAcceptance } from "../scripts/lib/flagship-journey-acceptance.mjs";

function gameplay(revision: number, count: number) {
  const ids = Array.from({ length: count }, (_, index) => `crystal-${index}`);
  return {
    projectId: "world-1",
    revision,
    expectedCollectibleIds: ids,
    collectedIds: ids,
    won: true,
    score: count,
    contacts: ["portal"],
    platformEvidence: ["a", "b", "c"].map((id) => ({
      id,
      behavior: "bounce",
      groundedFrames: 1,
      bounceFrames: 1,
      maximumDisplacement: 0.2,
    })),
    win: {
      projectId: "world-1",
      revision,
      status: "won",
      score: count,
      portalId: "portal",
    },
    reset: {
      projectId: "world-1",
      revision,
      status: "playing",
      score: 0,
      scoreIds: [],
      lifecycleAdvanced: true,
      player: { position: [0, 1, 5] },
    },
  };
}
function completeReport(): any {
  const artifact = { bytes: 100, sha256: "a".repeat(64) };
  return {
    mode: "live-browser",
    traffic: { generationRequests: 3, interceptedGeneration: false },
    creation: {
      status: "passed",
      seedObserved: true,
      gameplayDuringGeneration: {
        status: "passed",
        projectId: "world-1",
        generationStreamOpenAtMovement: true,
        generationStreamOpenAfterMovement: true,
        movementDistance: 0.3,
        revisionBefore: 1,
        revisionAfter: 2,
      },
    },
    edit: { selectedIdPreserved: true },
    flagshipStory: {
      status: "passed",
      limitations: [],
      phases: {
        creation: { revision: 4, gameplay: gameplay(4, 5) },
        mushroom: { status: "passed", revision: 5 },
        goal7: {
          status: "passed",
          revision: 6,
          objective: { collectibleCount: 7, portalThreshold: 7 },
          gameplay: gameplay(6, 7),
        },
        undo: { gameplay: gameplay(7, 5) },
      },
      undo: {
        restoredRevision: 7,
        restoredMushroomState: true,
        objective: { collectibleCount: 5, portalThreshold: 5 },
      },
    },
    followOn: { projectId: "world-1", revision: 7 },
    localRecovery: "passed",
    export: "passed",
    standaloneGameplay: gameplay(7, 5),
    publication: {
      mode: "real",
      status: "READY",
      projectId: "world-1",
      revision: 7,
      signedOut: true,
      editorProviderRequests: 0,
      gameplay: gameplay(7, 5),
      artifactEvidence: {
        manifest: { projectId: "world-1", revision: 7 },
        files: Object.fromEntries(
          [
            "runtime.js",
            "runtime.css",
            "generated-geometry-worker.js",
            "asset-geometry-worker.js",
          ].map((file) => [
            file,
            { target: artifact, expected: artifact, observed: artifact },
          ]),
        ),
      },
    },
  };
}

describe("complete flagship journey gate", () => {
  it("accepts a complete evidence contract without claiming provider authentication", () => {
    const result = flagshipJourneyAcceptance(completeReport());
    expect(result.status).toBe("complete");
    expect(result.missing).toEqual([]);
    expect(result.scope).toContain("authentication");
  });
  it.each(["goal7", "undo"])(
    "rejects omitted %s traversal even when structural checks pass",
    (phase) => {
      const report = completeReport();
      delete report.flagshipStory.phases[phase].gameplay;
      expect(flagshipJourneyAcceptance(report).status).toBe("incomplete");
    },
  );
  it.each(["not-run", "blocked", "structural-passed"])(
    "rejects %s story scope",
    (status) => {
      const report = completeReport();
      report.flagshipStory.status = status;
      expect(flagshipJourneyAcceptance(report).missing).toContain(
        "complete-story-scope",
      );
    },
  );
  it("rejects seeded or intercepted creation and movement after stream closure", () => {
    const report = completeReport();
    report.flagshipResume = { mode: "live" };
    report.traffic.interceptedGeneration = true;
    report.creation.gameplayDuringGeneration.generationStreamOpenAfterMovement = false;
    expect(flagshipJourneyAcceptance(report).missing).toEqual(
      expect.arrayContaining([
        "fresh-live-generation",
        "movement-during-generation",
      ]),
    );
  });
  it("rejects missing publication gameplay, signed-in playback and old runtime bytes", () => {
    const report = completeReport();
    delete report.publication.gameplay;
    report.publication.signedOut = false;
    report.publication.artifactEvidence.files["runtime.js"].observed = {
      bytes: 99,
      sha256: "b".repeat(64),
    };
    expect(flagshipJourneyAcceptance(report).missing).toEqual(
      expect.arrayContaining([
        "published-win-restart",
        "signed-out-publication",
        "current-publication-artifacts",
      ]),
    );
  });
  it("rejects mismatched scene identity/revision and stale reset state", () => {
    const report = completeReport();
    report.flagshipStory.phases.goal7.gameplay.projectId = "other";
    report.flagshipStory.phases.undo.gameplay.revision = 6;
    report.standaloneGameplay.reset.lifecycleAdvanced = false;
    report.publication.gameplay.reset.player.position[0] = 8;
    report.followOn.revision = 6;
    expect(flagshipJourneyAcceptance(report).missing).toEqual(
      expect.arrayContaining([
        "seven-win-reset",
        "undo-win-reset",
        "standalone-win-reset",
        "same-project-refresh-export",
        "published-win-restart",
      ]),
    );
  });
  it("rejects duplicate collectibles and unobserved platform motion", () => {
    const report = completeReport();
    report.flagshipStory.phases.creation.gameplay.collectedIds.fill(
      "crystal-0",
    );
    report.flagshipStory.phases.creation.gameplay.platformEvidence[0].maximumDisplacement = 0;
    expect(flagshipJourneyAcceptance(report).missing).toContain(
      "creation-win-reset",
    );
  });
  it("handles absent and partial reports without granting completeness", () => {
    for (const report of [
      undefined,
      {},
      { flagshipStory: { status: "passed" } },
    ])
      expect(flagshipJourneyAcceptance(report).status).toBe("incomplete");
  });
});
