export type InitialProjectFramePhase = "landing" | "descending" | "editing";

export type InitialProjectFrameLifecycle = Readonly<{
  projectId: string;
  phase: InitialProjectFramePhase;
  building: boolean;
  entityCount: number;
}>;

export type InitialProjectFrameAttempt = {
  projectId: string;
  userNavigated: boolean;
};

export type InitialProjectFrameSettlement = Readonly<{
  projectId: string;
  phase: InitialProjectFramePhase;
  building: boolean;
  playing: boolean;
  hasError: boolean;
  hasRecovery: boolean;
  hasCommittedBounds: boolean;
  userNavigated: boolean;
}>;

export function isInitialProjectFrameBuildStart(
  previous: InitialProjectFrameLifecycle,
  current: InitialProjectFrameLifecycle,
) {
  return (
    previous.projectId !== current.projectId &&
    previous.phase === "landing" &&
    !previous.building &&
    current.phase === "descending" &&
    current.building &&
    current.entityCount === 0
  );
}

export function initialProjectFrameSettlement(
  attempt: InitialProjectFrameAttempt,
  current: InitialProjectFrameSettlement,
): "wait" | "frame" | "discard" {
  if (
    attempt.projectId !== current.projectId ||
    current.phase === "landing" ||
    current.playing ||
    current.hasError ||
    current.hasRecovery ||
    current.userNavigated
  )
    return "discard";
  if (current.building) return "wait";
  return current.hasCommittedBounds ? "frame" : "discard";
}
