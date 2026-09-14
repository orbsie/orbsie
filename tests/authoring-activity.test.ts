import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AUTHORING_ACTIVITY_LIMIT,
  AUTHORING_ACTIVITY_INTERVAL_MS,
  appendAuthoringActivity,
  authoringEntityLabel,
  createAuthoringActivityThrottle,
  latestAuthoringActivity,
  type AuthoringActivity,
  type AuthoringActivityDraft,
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
  afterEach(() => vi.useRealTimers());

  function draft(
    kind: AuthoringActivityDraft["kind"],
    message: string = kind,
  ): AuthoringActivityDraft {
    return {
      runId: "run-1",
      projectId: "project-1",
      revision: 0,
      kind,
      message,
    };
  }

  it("publishes the first update immediately and coalesces bursts", () => {
    vi.useFakeTimers();
    const published: AuthoringActivityDraft[] = [];
    const throttle = createAuthoringActivityThrottle((event) =>
      published.push(event),
    );

    throttle.publish(draft("waiting", "Waiting"));
    throttle.publish(draft("constructing", "Building one"));
    throttle.publish(draft("preparing", "Preparing two"));
    expect(published.map((event) => event.message)).toEqual(["Waiting"]);

    vi.advanceTimersByTime(AUTHORING_ACTIVITY_INTERVAL_MS - 1);
    expect(published).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(published.map((event) => event.message)).toEqual([
      "Waiting",
      "Preparing two",
    ]);
  });

  it("keeps sustained intermediate updates two seconds apart", () => {
    vi.useFakeTimers();
    const published: AuthoringActivityDraft[] = [];
    const throttle = createAuthoringActivityThrottle((event) =>
      published.push(event),
    );

    throttle.publish(draft("waiting"));
    vi.advanceTimersByTime(500);
    throttle.publish(draft("constructing", "one"));
    vi.advanceTimersByTime(500);
    throttle.publish(draft("preparing", "two"));
    vi.advanceTimersByTime(500);
    throttle.publish(draft("applied", "three"));
    vi.advanceTimersByTime(500);
    expect(published.map((event) => event.message)).toEqual([
      "waiting",
      "three",
    ]);

    vi.advanceTimersByTime(500);
    throttle.publish(draft("applied", "four"));
    vi.advanceTimersByTime(1_499);
    expect(published.map((event) => event.message)).toEqual([
      "waiting",
      "three",
    ]);
    vi.advanceTimersByTime(1);
    expect(published.map((event) => event.message)).toEqual([
      "waiting",
      "three",
      "four",
    ]);
  });

  it("flushes terminal outcomes immediately and clears pending work", () => {
    vi.useFakeTimers();
    const published: AuthoringActivityDraft[] = [];
    const throttle = createAuthoringActivityThrottle((event) =>
      published.push(event),
    );

    throttle.publish(draft("waiting"));
    vi.advanceTimersByTime(100);
    throttle.publish(draft("preparing", "stale intermediate"));
    throttle.publish(draft("failed", "Failed"));
    expect(published.map((event) => event.message)).toEqual([
      "waiting",
      "Failed",
    ]);
    vi.advanceTimersByTime(AUTHORING_ACTIVITY_INTERVAL_MS);
    expect(published).toHaveLength(2);
  });

  it("drops a scheduled callback when a run is cleared", () => {
    vi.useFakeTimers();
    const published: AuthoringActivityDraft[] = [];
    const throttle = createAuthoringActivityThrottle((event) =>
      published.push(event),
    );

    throttle.publish(draft("waiting"));
    throttle.publish(draft("constructing"));
    throttle.clear();
    vi.advanceTimersByTime(AUTHORING_ACTIVITY_INTERVAL_MS);
    expect(published.map((event) => event.message)).toEqual(["waiting"]);
  });

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
