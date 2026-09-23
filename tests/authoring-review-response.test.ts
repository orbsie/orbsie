import { describe, expect, it } from "vitest";
import { parseAuthoringReviewResponse } from "../src/lib/authoring-review-response";

const digest = "a".repeat(64);
const expected = {
  projectId: "world",
  revision: 5,
  phase: "review" as const,
  scope: "structural-only" as const,
  browserModeling: false,
  entityIds: ["tree"],
};

function reply(
  verdict: "accept" | "revise" = "accept",
  phase: "review" | "final-review" = "review",
) {
  const correcting = verdict === "revise" && phase === "review";
  const correction = {
    type: "set_environment",
    sky: "#abcdef",
  };
  const corrections = correcting
    ? [correction, { type: "commit_revision", message: "Fixed the sky." }]
    : [];
  const revision = expected.revision + corrections.length;
  return {
    review: {
      version: 1,
      projectId: expected.projectId,
      reviewedRevision: expected.revision,
      scope: expected.scope,
      verdict,
      summary: verdict === "accept" ? "Looks ready." : "The sky is wrong.",
      issues:
        verdict === "accept"
          ? []
          : [{ summary: "The sky is wrong.", entityIds: [] }],
      corrections: correcting ? [correction] : [],
    },
    corrections,
    binding: { revision, digest },
    revision,
    digest,
    scope: expected.scope,
    remainingCalls: correcting ? 1 : 0,
  };
}

describe("public authoring review response", () => {
  it("accepts a bound accept verdict and a single canonical correction batch", () => {
    const accepted = parseAuthoringReviewResponse(reply(), expected);
    expect(accepted.review.verdict).toBe("accept");
    expect(accepted.corrections).toEqual([]);
    const revised = parseAuthoringReviewResponse(reply("revise"), expected);
    expect(revised.corrections.at(-1)?.type).toBe("commit_revision");
    expect(revised.binding.revision).toBe(expected.revision + 2);
  });

  it("accepts a final partial verdict without another correction call", () => {
    const result = parseAuthoringReviewResponse(
      reply("revise", "final-review"),
      {
        ...expected,
        phase: "final-review",
      },
    );
    expect(result.review.verdict).toBe("revise");
    expect(result.corrections).toEqual([]);
    expect(result.remainingCalls).toBe(0);
  });

  it("rejects a mismatched binding, scope, or project", () => {
    expect(() =>
      parseAuthoringReviewResponse(
        { ...reply(), digest: "b".repeat(64) },
        expected,
      ),
    ).toThrow("inconsistent");
    expect(() =>
      parseAuthoringReviewResponse(
        { ...reply(), scope: "visual+structural" },
        expected,
      ),
    ).toThrow("inconsistent");
    expect(() =>
      parseAuthoringReviewResponse(
        {
          ...reply(),
          review: { ...reply().review, projectId: "another-world" },
        },
        expected,
      ),
    ).toThrow("another world");
  });

  it("rejects an uncommitted or oversized correction batch", () => {
    const revised = reply("revise");
    expect(() =>
      parseAuthoringReviewResponse(
        { ...revised, corrections: revised.corrections.slice(0, -1) },
        expected,
      ),
    ).toThrow("inconsistent");
    expect(() =>
      parseAuthoringReviewResponse({ ...revised, remainingCalls: 0 }, expected),
    ).toThrow("inconsistent");
    expect(() =>
      parseAuthoringReviewResponse(
        { ...revised, binding: { revision: 99, digest }, revision: 99 },
        expected,
      ),
    ).toThrow("inconsistent");
  });
});
