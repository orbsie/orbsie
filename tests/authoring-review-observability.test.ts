import { expect, it } from "vitest";
import { createAuthoringReviewDiagnostic } from "../src/lib/server/authoring-review-observability";

const common = {
  requestId: "11111111-1111-4111-8111-111111111111",
  phase: "final-review" as const,
  scope: "visual+structural" as const,
  timestamp: "2026-09-23T12:00:00.000Z",
};

it("includes failureKind only on failed or cancelled terminal diagnostics", () => {
  expect(
    createAuthoringReviewDiagnostic({
      ...common,
      state: "terminal",
      outcome: "failed",
      failureKind: "provider-response",
    }),
  ).toMatchObject({
    state: "terminal",
    outcome: "failed",
    failureKind: "provider-response",
  });

  expect(
    createAuthoringReviewDiagnostic({
      ...common,
      state: "terminal",
      outcome: "cancelled",
      failureKind: "route-aborted",
    }),
  ).toMatchObject({ outcome: "cancelled", failureKind: "route-aborted" });

  const admission = createAuthoringReviewDiagnostic({
    ...common,
    state: "admission",
    outcome: "admitted",
    failureKind: "provider-response",
  });
  const success = createAuthoringReviewDiagnostic({
    ...common,
    state: "terminal",
    outcome: "accepted",
    failureKind: "provider-response",
  });
  expect(admission).not.toHaveProperty("failureKind");
  expect(success).not.toHaveProperty("failureKind");
});

it("drops failure kinds outside the fixed allowlist", () => {
  const raw = "502 private response body api-key-secret";
  const event = createAuthoringReviewDiagnostic({
    ...common,
    state: "terminal",
    outcome: "failed",
    failureKind: raw,
  });

  expect(event).not.toHaveProperty("failureKind");
  expect(JSON.stringify(event)).not.toContain(raw);
});
