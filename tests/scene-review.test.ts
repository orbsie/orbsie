import { describe, expect, it } from "vitest";
import { parseSceneReviewResult } from "../src/lib/scene-review";

const expected = {
  projectId: "world-1",
  revision: 4,
  scope: "structural-only" as const,
  phase: "review" as const,
  browserModeling: true,
  entityIds: ["tree-1"],
};
const accepted = {
  version: 1,
  projectId: "world-1",
  reviewedRevision: 4,
  scope: "structural-only",
  verdict: "accept",
  summary: "The structure is consistent.",
  issues: [],
  corrections: [],
};
const revise = {
  ...accepted,
  verdict: "revise",
  summary: "The scene needs a clearer sky.",
  issues: [{ summary: "The dark sky hides the tree.", entityIds: ["tree-1"] }],
  corrections: [{ type: "set_environment", sky: "#aabbff" }],
};

describe("phase-bound scene review results", () => {
  it("accepts a separate typed verdict without extracting commit prose", () => {
    expect(parseSceneReviewResult(accepted, expected).verdict).toBe("accept");
    expect(() =>
      parseSceneReviewResult(
        { type: "commit_revision", message: "accepted" },
        expected,
      ),
    ).toThrow();
  });
  it("accepts first corrections and a final honest partial result", () => {
    expect(parseSceneReviewResult(revise, expected).corrections).toHaveLength(
      1,
    );
    expect(
      parseSceneReviewResult(
        { ...revise, corrections: [] },
        { ...expected, phase: "final-review" },
      ).verdict,
    ).toBe("revise");
  });
  it("rejects stale worlds, revisions, and invented visual evidence", () => {
    for (const changed of [
      { projectId: "other" },
      { reviewedRevision: 3 },
      { scope: "visual+structural" },
    ])
      expect(() =>
        parseSceneReviewResult({ ...accepted, ...changed }, expected),
      ).toThrow();
  });
  it("rejects contradictory verdicts and non-actionable first reviews", () => {
    for (const changed of [
      { verdict: "accept" },
      { issues: [] },
      { corrections: [] },
    ])
      expect(() =>
        parseSceneReviewResult({ ...revise, ...changed }, expected),
      ).toThrow();
  });
  it("rejects a fourth mutation, model-owned commits, and unknown issue targets", () => {
    expect(() =>
      parseSceneReviewResult(revise, { ...expected, phase: "final-review" }),
    ).toThrow();
    expect(() =>
      parseSceneReviewResult(
        {
          ...revise,
          corrections: [{ type: "commit_revision", message: "all done" }],
        },
        expected,
      ),
    ).toThrow();
    expect(() =>
      parseSceneReviewResult(
        { ...revise, issues: [{ summary: "Missing", entityIds: ["other"] }] },
        expected,
      ),
    ).toThrow();
  });
  it("bounds summaries and corrections and rejects unrelated top-level fields", () => {
    for (const changed of [
      { summary: "x".repeat(601) },
      { corrections: Array(17).fill(revise.corrections[0]) },
      { credential: "must not be here" },
    ])
      expect(() =>
        parseSceneReviewResult({ ...revise, ...changed }, expected),
      ).toThrow();
  });
});
