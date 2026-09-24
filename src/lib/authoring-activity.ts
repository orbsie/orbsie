export const AUTHORING_ACTIVITY_LIMIT = 18;
export const AUTHORING_ACTIVITY_INTERVAL_MS = 2_000;

export type AuthoringActivityKind =
  | "waiting"
  | "constructing"
  | "preparing"
  | "applied"
  | "completed"
  | "cancelled"
  | "failed";

export type AuthoringActivity = {
  id: string;
  runId: string;
  projectId: string;
  revision: number;
  kind: AuthoringActivityKind;
  message: string;
  at: number;
};

export type AuthoringActivityDraft = Omit<AuthoringActivity, "id" | "at">;

type ActivityTimer = ReturnType<typeof globalThis.setTimeout>;
type ActivityScheduler = {
  now?: () => number;
  setTimeout?: (callback: () => void, delay: number) => ActivityTimer;
  clearTimeout?: (timer: ActivityTimer) => void;
};

const terminalActivityKinds = new Set<AuthoringActivityKind>([
  "completed",
  "cancelled",
  "failed",
]);

/** Publish the first update immediately and coalesce later updates by run. */
export function createAuthoringActivityThrottle(
  publish: (event: AuthoringActivityDraft) => void,
  scheduler: ActivityScheduler = {},
) {
  const now = scheduler.now ?? Date.now;
  const schedule =
    scheduler.setTimeout ??
    ((callback: () => void, delay: number) =>
      globalThis.setTimeout(callback, delay));
  const cancel =
    scheduler.clearTimeout ??
    ((timer: ActivityTimer) => globalThis.clearTimeout(timer));
  let lastPublishedAt: number | undefined;
  let pending: AuthoringActivityDraft | undefined;
  let timer: ActivityTimer | undefined;
  let generation = 0;

  const emit = (event: AuthoringActivityDraft) => {
    lastPublishedAt = now();
    publish(event);
  };
  const flush = (expectedGeneration: number) => {
    if (expectedGeneration !== generation) return;
    timer = undefined;
    if (!pending) return;
    const remaining = Math.max(
      0,
      AUTHORING_ACTIVITY_INTERVAL_MS - (now() - (lastPublishedAt ?? 0)),
    );
    if (remaining > 0) {
      timer = schedule(() => flush(expectedGeneration), remaining);
      return;
    }
    const event = pending;
    pending = undefined;
    emit(event);
  };
  const schedulePending = () => {
    if (timer !== undefined) return;
    const expectedGeneration = generation;
    const remaining = Math.max(
      0,
      AUTHORING_ACTIVITY_INTERVAL_MS -
        (now() - (lastPublishedAt ?? Number.NEGATIVE_INFINITY)),
    );
    timer = schedule(() => flush(expectedGeneration), remaining);
  };

  return {
    publish(event: AuthoringActivityDraft) {
      if (terminalActivityKinds.has(event.kind)) {
        pending = undefined;
        if (timer !== undefined) {
          cancel(timer);
          timer = undefined;
        }
        emit(event);
        return;
      }
      const current = now();
      if (
        lastPublishedAt === undefined ||
        current - lastPublishedAt >= AUTHORING_ACTIVITY_INTERVAL_MS
      ) {
        pending = undefined;
        emit(event);
      } else {
        pending = event;
        schedulePending();
      }
    },
    clear() {
      generation += 1;
      pending = undefined;
      if (timer !== undefined) cancel(timer);
      timer = undefined;
      lastPublishedAt = undefined;
    },
  };
}

export function appendAuthoringActivity(
  current: readonly AuthoringActivity[],
  event: AuthoringActivity,
): AuthoringActivity[] {
  const next = current.some((entry) => entry.id === event.id)
    ? [...current]
    : [...current, event];
  return next.slice(-AUTHORING_ACTIVITY_LIMIT);
}

export function authoringEntityLabel(label: string | undefined): string {
  const cleaned = (label ?? "new object")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "new object";
  return cleaned.length > 48 ? `${cleaned.slice(0, 48).trimEnd()}…` : cleaned;
}

/** Keep review findings readable and bounded before adding them to a project. */
export function authoringReviewIssueSummary(summary: string): string {
  const cleaned = summary
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "A scene issue remains.";
  const characters = Array.from(cleaned);
  if (characters.length <= 180) return cleaned;
  return `${characters.slice(0, 179).join("").trimEnd()}…`;
}

export function latestAuthoringActivity(
  events: readonly AuthoringActivity[],
): AuthoringActivity | undefined {
  return events.at(-1);
}
