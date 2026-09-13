export const AUTHORING_ACTIVITY_LIMIT = 18;

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

export function latestAuthoringActivity(
  events: readonly AuthoringActivity[],
): AuthoringActivity | undefined {
  return events.at(-1);
}
