import { describe, expect, it } from "vitest";
import {
  AUTHORING_ACTIVITY_LIMIT,
  appendAuthoringActivity,
  authoringEntityLabel,
  latestAuthoringActivity,
  type AuthoringActivity,
} from "../src/lib/authoring-activity";

function event(id: string): AuthoringActivity {
  return {
    id,
    runId: "run-1",
    projectId: "project-1",
    revision: 0,
    kind: "applied",
    message: id,
    at: Number(id.replace("event-", "")),
  };
}

describe("authoring activity", () => {
  it("keeps a bounded ordered ledger and deduplicates callbacks", () => {
    let activity: AuthoringActivity[] = [];
    for (let i = 0; i < AUTHORING_ACTIVITY_LIMIT + 3; i++)
      activity = appendAuthoringActivity(activity, event(`event-${i}`));

    expect(activity).toHaveLength(AUTHORING_ACTIVITY_LIMIT);
    expect(activity[0].id).toBe("event-3");
    expect(latestAuthoringActivity(activity)?.id).toBe(
      `event-${AUTHORING_ACTIVITY_LIMIT + 2}`,
    );
    expect(appendAuthoringActivity(activity, event("event-4"))).toEqual(
      activity,
    );
  });

  it("turns model labels into compact plain-language names", () => {
    expect(authoringEntityLabel("  lantern\n  \u0000\t\t")).toBe("lantern");
    expect(authoringEntityLabel(undefined)).toBe("new object");
    expect(authoringEntityLabel("x".repeat(60))).toBe(`${"x".repeat(48)}…`);
  });
});
