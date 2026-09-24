"use client";
import { ZodError } from "zod";
import {
  appendCloudGenerationOperation,
  cancelCloudGenerationRun,
} from "./cloud-generation-journal";
import type { GenerationRun } from "./generation-journal";
import {
  uploadCloudGeneratedModels,
  downloadCloudGeneratedModels,
} from "./cloud-generated-models";
import { assertModelingCommand } from "./modeling-policy";
import { buildBrowserModel } from "./browser-modeling-connection";
import {
  canonicalBrowserProceduralSource,
  hashBrowserProceduralSource,
} from "./browser-procedural";
import { evaluateBrowserProceduralInWorker } from "./browser-procedural-queue";
import type { BrowserModelRecipe } from "./browser-modeling";
import { deriveAssetPolicy, enforceAssetPolicy } from "./asset-policy";
import { assertAppliedAuthoringReviewBinding } from "./authoring-review-binding";
import {
  authoringReviewRequest,
  authoringReviewStartRequest,
} from "./authoring-review-connection";
import { parseAuthoringReviewResponse } from "./authoring-review-response";
import { captureSceneReview } from "./scene-review-capture";
import { sceneReviewObservationsFromCapture } from "./scene-review-observations-client";
import type { SceneReviewImage } from "./review-image";
import { GAME_RULES_RESTART_NOTICE } from "./game-session";
import {
  generationRequest,
  isGenerationReady,
  type GenerationConnection,
} from "./generation-connection";
import { create } from "zustand";
import { clear, get, update } from "idb-keyval";
import {
  blankProject,
  commandSchema,
  committed,
  projectSchema,
  applyOperation,
  parseModelCommandForProcessing,
  type Project,
  type Command,
  type ModelCommand,
  type Cursor,
} from "./protocol";
import {
  beginExperience,
  finishExperience,
  markExperience,
  noteReservation,
  noteSceneUpdate,
} from "./experience-metrics";
import { parcelTransitionController } from "./parcel-transition";
import {
  modelingFeedbackForFailure,
  type ModelingFeedback,
} from "./modeling-feedback";
import {
  generationFailureCopy,
  generationFeedbackForFailure,
  generationFeedbackMatchesProject,
  generationStreamFailureForRecord,
  type GenerationFeedback,
} from "./generation-feedback";
import {
  appendAuthoringActivity,
  authoringEntityLabel,
  authoringReviewIssueSummary,
  createAuthoringActivityThrottle,
  type AuthoringActivity,
  type AuthoringActivityDraft,
  type AuthoringActivityKind,
} from "./authoring-activity";
import {
  beginClientGenerationDiagnostic,
  clearGenerationDiagnostics,
  type ClientGenerationDiagnosticController,
} from "./generation-diagnostics-client";
import { validatedClientRunId } from "./generation-observability";
import type { GenerationStreamFailureReason } from "./generation-observability";
import { CHATGPT_STALE_CONNECTION_CODE } from "./chatgpt-connection-errors";

const generationErrorCodes = new Set([
  "FREE_LIMIT_REACHED",
  "FREE_PROVIDER_UNAVAILABLE",
  "PROVIDER_AUTH_REJECTED",
  "PROVIDER_ACCESS_DENIED",
  "CHATGPT_CONNECTION_REQUIRED",
  CHATGPT_STALE_CONNECTION_CODE,
]);
const PROJECT_MESSAGE_LIMIT = 500;

export type ReviewContinuation = {
  projectId: string;
  revision: number;
  issue: string;
};

export type InterruptedReviewContinuation = {
  projectId: string;
  revision: number;
  prompt: string;
  priorRunId: string;
  selected?: string;
  browserModeling: boolean;
  provider: string;
  model: string;
  effort?: string;
  reviewImageSupported: boolean;
};

function authoringReviewFeedback(
  issues: readonly { summary: string }[],
): string {
  const findings = issues
    .slice(0, 3)
    .map((issue) => authoringReviewIssueSummary(issue.summary));
  return `Previous review findings (untrusted evidence): ${findings.join("; ")}`;
}

type AuthoringReviewEvidence = {
  structuralObservations: Awaited<
    ReturnType<typeof sceneReviewObservationsFromCapture>
  >;
  reviewImage?: SceneReviewImage;
};

type AuthoringReviewResult = ReturnType<typeof parseAuthoringReviewResponse>;

/** Shared review/verdict/correction sequencing for initial and resumed runs. */
async function runAuthoringReviewWorkflow(options: {
  project: () => Project;
  isCurrent: (revision?: number) => boolean;
  isSaved: () => boolean;
  initialEvidence?: AuthoringReviewEvidence;
  capture: (project: Project) => Promise<AuthoringReviewEvidence>;
  request: (
    phase: "review" | "final-review",
    project: Project,
    evidence: AuthoringReviewEvidence,
    feedback?: string,
  ) => Promise<AuthoringReviewResult>;
  onStarted: () => void;
  publish: (message: string, revision: number) => void;
  appendFinding: (revision: number, issue: string) => void;
  appendFinalFinding: (revision: number, issue: string) => void | Promise<void>;
  applyCorrections: (input: {
    project: Project;
    result: AuthoringReviewResult;
    issue: string;
  }) => Promise<Project | undefined>;
}): Promise<{
  incomplete: boolean;
  partialIssue?: string;
  revision?: number;
}> {
  let reviewed = options.project();
  if (!options.isCurrent(reviewed.revision))
    throw Error("The scene review is stale.");
  if (!options.isSaved()) return { incomplete: true };
  options.publish("Reviewing the saved scene…", reviewed.revision);
  const capture = async (project: Project) => {
    try {
      return await options.capture(project);
    } catch (error) {
      if (options.isCurrent(project.revision)) return undefined;
      throw error;
    }
  };
  let evidence = options.initialEvidence ?? (await capture(reviewed));
  if (!evidence) return { incomplete: true };
  options.onStarted();
  let phase: "review" | "final-review" = "review";
  let correctionReviews = 0;
  let previousReviewFeedback: string | undefined;
  while (true) {
    if (!options.isCurrent(reviewed.revision))
      throw Error("The scene review is stale.");
    const result = await options.request(
      phase,
      reviewed,
      evidence,
      previousReviewFeedback,
    );
    if (!options.isCurrent(reviewed.revision))
      throw Error("The scene review is stale.");
    if (result.review.verdict === "accept") {
      await assertAppliedAuthoringReviewBinding(reviewed, {
        projectId: reviewed.id,
        ...result.binding,
      });
      return { incomplete: false };
    }
    if (phase === "final-review") {
      await assertAppliedAuthoringReviewBinding(reviewed, {
        projectId: reviewed.id,
        ...result.binding,
      });
      const issue = authoringReviewIssueSummary(
        result.review.issues[0]!.summary,
      );
      await options.appendFinalFinding(reviewed.revision, issue);
      return {
        incomplete: false,
        partialIssue: issue,
        revision: reviewed.revision,
      };
    }
    if (correctionReviews === 1 && result.remainingCalls !== 1)
      return { incomplete: true };
    const issue = authoringReviewIssueSummary(result.review.issues[0]!.summary);
    previousReviewFeedback = authoringReviewFeedback(result.review.issues);
    options.appendFinding(reviewed.revision, issue);
    const corrected = await options.applyCorrections({
      project: reviewed,
      result,
      issue,
    });
    if (!corrected) return { incomplete: true };
    await assertAppliedAuthoringReviewBinding(corrected, {
      projectId: corrected.id,
      ...result.binding,
    });
    reviewed = corrected;
    if (!options.isCurrent(reviewed.revision))
      throw Error("The scene review is stale.");
    options.publish("Checking the corrected scene…", reviewed.revision);
    evidence = await capture(reviewed);
    if (!evidence) return { incomplete: true };
    correctionReviews += 1;
    phase =
      result.remainingCalls > 1 && correctionReviews < 2
        ? "review"
        : "final-review";
  }
}

function validatedGenerationErrorCode(value: unknown): string | undefined {
  return typeof value === "string" && generationErrorCodes.has(value)
    ? value
    : undefined;
}

function generationFailureCode(reason: GenerationStreamFailureReason) {
  switch (reason) {
    case "clean-eof-without-commit":
    case "parser-failure":
      return "parser" as const;
    case "provider-error":
      return "provider-rejected" as const;
    case "stream-error":
    case "transport-error":
      return "transport" as const;
    case "completion-record-failure":
      return "host-unavailable" as const;
    case "deadline":
      return "timeout" as const;
    case "output-limit":
      return "output-limit" as const;
  }
}
export type GenerationJournalConnection = {
  isCurrent: () => boolean;
  begin: (
    project: Project,
    runId: string,
    prompt: string,
    selected?: string,
  ) => Promise<GenerationRun>;
};
export type CloudJournalAcknowledgement = {
  revision: number;
  snapshotToken: string;
};

/** Verify that a correction segment still follows the save it reviewed. */
export function assertCloudJournalBaseline(
  acknowledged: CloudJournalAcknowledgement,
  latest: CloudJournalAcknowledgement,
) {
  if (
    acknowledged.revision !== latest.revision ||
    acknowledged.snapshotToken !== latest.snapshotToken
  )
    throw Error(
      "A newer cloud save exists. Your local draft is still saved on this device.",
    );
}

/** Review is available for an admitted linked provider or an available trial. */
export function authoringReviewEligibleForConnection(
  configured: boolean,
  connection: GenerationConnection,
  freeAllowanceAvailable: boolean,
) {
  if (!configured) return false;
  if (connection.provider === "free") return freeAllowanceAvailable;
  return (
    isGenerationReady(connection) ||
    (connection.provider !== "chatgpt-hosted" && freeAllowanceAvailable)
  );
}
export type Phase = "landing" | "descending" | "editing";
type LocalHistory = { project: Project; history: Project[]; future: Project[] };
const HISTORY_LIMIT = 20;
export type GenerationRecovery = {
  projectId: string;
  prompt: string;
  selected?: string;
  checkpoint: Project;
  feedback?: GenerationFeedback;
};
function browserModelingAvailable() {
  return typeof Worker !== "undefined" && typeof WebAssembly !== "undefined";
}
function readLocalHistory(
  value: unknown,
  project: Project,
): LocalHistory | undefined {
  if (!value || typeof value !== "object") return;
  const record = value as Partial<LocalHistory>;
  const saved = projectSchema.safeParse(record.project);
  if (
    !saved.success ||
    JSON.stringify(saved.data) !== JSON.stringify(projectSchema.parse(project))
  )
    return;
  const valid = (entries: unknown, future = false) => {
    if (!Array.isArray(entries)) return [];
    const bounded = future
      ? entries.slice(0, HISTORY_LIMIT)
      : entries.slice(-HISTORY_LIMIT);
    return bounded.flatMap((entry) => {
      const parsed = projectSchema.safeParse(entry);
      return parsed.success &&
        parsed.data.id === project.id &&
        parsed.data.revision <= project.revision
        ? [committed(parsed.data)]
        : [];
    });
  };
  return {
    project: saved.data,
    history: valid(record.history),
    future: valid(record.future, true),
  };
}
interface State {
  project: Project;
  phase: Phase;
  playing: boolean;
  building: boolean;
  selected?: string;
  history: Project[];
  future: Project[];
  score: string[];
  won: boolean;
  lost: boolean;
  gameScore: number;
  ruleRestartCount: number;
  notice: string;
  error: string;
  generationErrorCode?: string;
  generationRecovery?: GenerationRecovery;
  modelingFeedback?: ModelingFeedback;
  authoringActivity: AuthoringActivity[];
  reviewContinuation?: ReviewContinuation;
  interruptedReviewContinuation?: InterruptedReviewContinuation;
  saved: boolean;
  recovered?: Project;
  drafts: Project[];
  draftHistory: Record<string, LocalHistory>;
  readOnly: boolean;
  reset: number;
  set: (patch: Partial<State>) => void;
  run: (
    prompt: string,
    connection?: GenerationConnection,
    journal?: GenerationJournalConnection,
    generationFeedback?: GenerationFeedback,
  ) => Promise<void>;
  resumeInterruptedReview: (
    connection: GenerationConnection,
    journal?: GenerationJournalConnection,
  ) => Promise<void>;
  stop: () => void;
  undo: () => void;
  redo: () => void;
  save: () => Promise<void>;
  recover: () => Promise<void>;
  loadDrafts: () => Promise<void>;
  readHistoryFor: (p: Project) => Promise<LocalHistory | undefined>;
  resetLocalData: () => Promise<void>;
  preserveLocalCopy: () => Promise<void>;
  loadCloud: (
    project: Project,
    isCurrent?: () => boolean,
    isInstalledCurrent?: () => boolean,
  ) => Promise<boolean>;
  load: (
    p: Project,
    play?: boolean,
    isCurrent?: () => boolean,
  ) => Promise<boolean>;
  collect: (id: string) => void;
}
type GenerationUiCheckpoint = Pick<
  State,
  | "phase"
  | "playing"
  | "selected"
  | "score"
  | "won"
  | "lost"
  | "gameScore"
  | "ruleRestartCount"
  | "reset"
  | "history"
  | "future"
>;
type LeaseStorage = Pick<Storage, "getItem" | "setItem">;
type DraftLease = { owner: string; expiresAt: number };
const LEASE_MS = 45000;
const tabId = crypto.randomUUID();
let leasedProject: string | undefined;
let leaseTimer: ReturnType<typeof setInterval> | undefined;
export function claimDraftLease(
  storage: LeaseStorage,
  projectId: string,
  owner: string,
  now: number,
) {
  const key = `orbsie-writer:${projectId}`;
  let lease: DraftLease | undefined;
  try {
    lease = JSON.parse(storage.getItem(key) ?? "null") ?? undefined;
  } catch {
    lease = undefined;
  }
  if (lease && lease.owner !== owner && lease.expiresAt > now) return false;
  storage.setItem(key, JSON.stringify({ owner, expiresAt: now + LEASE_MS }));
  try {
    return (
      (JSON.parse(storage.getItem(key) ?? "null") as DraftLease | null)
        ?.owner === owner
    );
  } catch {
    return false;
  }
}
export function releaseDraftLease(
  storage: LeaseStorage & Pick<Storage, "removeItem">,
  projectId: string,
  owner: string,
) {
  const key = `orbsie-writer:${projectId}`;
  try {
    const lease = JSON.parse(
      storage.getItem(key) ?? "null",
    ) as DraftLease | null;
    if (lease?.owner === owner) storage.removeItem(key);
  } catch {}
}
let leaseListeners = false;
function activateWriter(projectId: string) {
  if (typeof window === "undefined") return true;
  if (!claimDraftLease(localStorage, projectId, tabId, Date.now()))
    return false;
  leasedProject = projectId;
  if (!leaseListeners) {
    leaseListeners = true;
    window.addEventListener("pagehide", () => {
      if (leasedProject) releaseDraftLease(localStorage, leasedProject, tabId);
    });
    window.addEventListener("storage", (event) => {
      if (!leasedProject || event.key !== `orbsie-writer:${leasedProject}`)
        return;
      try {
        const next = JSON.parse(event.newValue ?? "null") as DraftLease | null;
        if (next && next.owner !== tabId) {
          useOrb.setState({
            readOnly: true,
            error:
              "Another tab took over this world. This tab is now read-only so your drafts cannot overwrite each other.",
          });
        }
      } catch {}
    });
  }
  if (!leaseTimer)
    leaseTimer = setInterval(() => {
      if (leasedProject)
        claimDraftLease(localStorage, leasedProject, tabId, Date.now());
    }, LEASE_MS / 3);
  return true;
}
async function withDraftWriteLock(
  projectId: string,
  write: () => Promise<boolean>,
) {
  if (typeof navigator === "undefined" || !navigator.locks) return write();
  return navigator.locks.request(
    `orbsie-write:${projectId}`,
    { mode: "exclusive" },
    write,
  );
}
function draftTitleFromPrompt(prompt: string): string {
  const cleaned = prompt.trim().replace(/\s+/g, " ");
  if (!cleaned) return "A pocketful of sunshine";
  return cleaned.length > 40 ? `${cleaned.slice(0, 40).trimEnd()}…` : cleaned;
}
let active: AbortController | undefined;
let baseline: Project | undefined;
let loadEpoch = 0;
let activeExperience: { projectId: string; token: string } | undefined;
let activeAuthoringRun:
  | {
      controller: AbortController;
      runId: string;
      projectId: string;
      diagnostic: ClientGenerationDiagnosticController;
      recovery: GenerationUiCheckpoint;
      initialRevision: number;
      publish: (
        kind: AuthoringActivityKind,
        message: string,
        revision?: number,
      ) => void;
      clear: () => void;
    }
  | undefined;
let activeReviewActivity:
  | {
      controller: AbortController;
      publish: (
        kind: AuthoringActivityKind,
        message: string,
        revision: number,
      ) => void;
      clear: () => void;
    }
  | undefined;

const AUTHORING_RUN_HEADER = "X-Orbsie-Authoring-Run-Id";
const REVIEW_IMAGE_HEADER = "X-Orbsie-Review-Image-Supported";
function clearActiveAuthoringRun() {
  const run = activeAuthoringRun;
  activeAuthoringRun = undefined;
  run?.diagnostic.terminal({
    reason: "stale-run",
    failureCode: "unknown",
  });
  run?.clear();
}
function invalidatePendingLoad() {
  return ++loadEpoch;
}
function finishActiveExperience(outcome: "success" | "error" | "cancelled") {
  const experience = activeExperience;
  if (!experience) return;
  activeExperience = undefined;
  finishExperience(experience.projectId, experience.token, outcome);
}
export const useOrb = create<State>((setState, getState) => ({
  project: blankProject(),
  phase: "landing",
  playing: false,
  building: false,
  history: [],
  future: [],
  score: [],
  won: false,
  lost: false,
  gameScore: 0,
  notice: "",
  ruleRestartCount: 0,
  error: "",
  authoringActivity: [],
  saved: false,
  drafts: [],
  draftHistory: {},
  readOnly: false,
  reset: 0,
  set(patch) {
    if ("project" in patch || "reset" in patch) {
      invalidatePendingLoad();
      clearActiveAuthoringRun();
      active?.abort();
      active = undefined;
    }
    if ("project" in patch)
      patch = {
        ...patch,
        building: false,
        generationRecovery: undefined,
        modelingFeedback: undefined,
        reviewContinuation: undefined,
        interruptedReviewContinuation: undefined,
      };
    if ("reset" in patch)
      patch = {
        ...patch,
        generationRecovery: undefined,
        reviewContinuation: undefined,
        interruptedReviewContinuation: undefined,
      };
    setState(patch);
  },
  async save() {
    const captured = getState();
    const capturedProject = captured.project;
    const capturedBaseline = baseline;
    const isCurrent = () => getState().project === capturedProject;
    try {
      if (!activateWriter(capturedProject.id)) {
        if (isCurrent())
          setState({
            readOnly: true,
            error:
              "This world is open in another tab. Continue there, or wait a moment before editing here.",
          });
        return;
      }
      const snapshot = committed(capturedProject, capturedBaseline);
      const history = readLocalHistory(
        {
          project: snapshot,
          history: captured.history,
          future: captured.future,
        },
        snapshot,
      )!;
      const wrote = await withDraftWriteLock(snapshot.id, async () => {
        let accepted = false;
        await update<Record<string, Project>>("orbsie-library", (library) => {
          const existing = library?.[snapshot.id];
          if (existing && existing.revision > snapshot.revision) return library;
          accepted = true;
          return { ...library, [snapshot.id]: snapshot };
        });
        if (!accepted) return false;
        await update<Record<string, LocalHistory>>(
          "orbsie-history",
          (records) => ({
            ...records,
            [snapshot.id]: history,
          }),
        );

        // A switched world still keeps its own library/history checkpoint, but
        // must not replace the compatibility pointer for the newly selected world.
        await update("orbsie-draft", (current) =>
          isCurrent() ? { ...history, savedAt: Date.now() } : current,
        );
        return true;
      });
      if (!wrote) {
        if (isCurrent())
          setState({
            readOnly: true,
            error:
              "A newer local draft was saved in another tab. This tab was made read-only.",
          });
        return;
      }
      if (!isCurrent()) return;
      setState({
        draftHistory: { ...getState().draftHistory, [snapshot.id]: history },
        saved: true,
        recovered: snapshot,
        drafts: [
          snapshot,
          ...getState().drafts.filter((p) => p.id !== snapshot.id),
        ],
      });
    } catch {
      if (isCurrent())
        setState({
          error:
            "This browser could not save your draft. Export it before closing.",
        });
    }
  },
  async loadCloud(
    project,
    isCurrent = () => true,
    isInstalledCurrent = () => true,
  ) {
    const startingProject = getState().project;
    const canInstall = () =>
      isCurrent() && getState().project === startingProject;
    if (!canInstall()) return false;
    if (!(await downloadCloudGeneratedModels(project, canInstall)))
      return false;
    if (!activateWriter(project.id))
      throw Error("This cloud world is being edited in another tab.");
    await getState().preserveLocalCopy();
    if (!canInstall()) return false;
    // Explicit cloud-open replaces the local baseline only after preserving
    // both the current draft and any divergent saved branch at the target ID.
    let recovered: Project | undefined;
    await withDraftWriteLock(project.id, async () => {
      await update<Record<string, Project>>("orbsie-library", (library) => {
        if (!canInstall()) return library ?? {};
        const existing = library?.[project.id];
        if (existing && JSON.stringify(existing) !== JSON.stringify(project)) {
          recovered = {
            ...existing,
            id: crypto.randomUUID(),
            title: `${existing.title} (local recovery)`,
          };
        }
        return {
          ...library,
          ...(recovered ? { [recovered.id]: recovered } : {}),
          [project.id]: project,
        };
      });
      return true;
    });
    if (!canInstall()) return false;
    if (recovered) setState({ drafts: [recovered, ...getState().drafts] });
    if (!(await getState().load(project, false, canInstall))) return false;
    const opened = getState().project;
    if (!isInstalledCurrent()) return false;
    await getState().save();
    return isInstalledCurrent() && getState().project === opened;
  },
  async preserveLocalCopy() {
    const copy = {
      ...committed(getState().project, baseline),
      id: crypto.randomUUID(),
      title: `${getState().project.title} (local recovery)`,
    };
    // A distinct identity preserves a divergent branch even after the cloud ID is saved.
    await update<Record<string, Project>>("orbsie-library", (library) => ({
      ...library,
      [copy.id]: copy,
    }));
    setState({ drafts: [copy, ...getState().drafts] });
  },
  async recover() {
    // Mount reads only the single current draft record. The full library and
    // history stores load on demand (loadDrafts / readHistoryFor) so heavy
    // local data cannot exhaust low-memory devices at page load.
    const currentProject = getState().project;
    try {
      const draft = await get("orbsie-draft");
      if (getState().project !== currentProject) return;
      const saved = projectSchema.safeParse(draft?.project);
      const recovered = saved.success ? saved.data : undefined;
      setState({
        recovered,
        drafts: recovered ? [recovered] : getState().drafts,
      });
    } catch {
      if (getState().project === currentProject)
        setState({
          error:
            "The saved draft could not be read. You can start a new world.",
        });
    }
  },
  async loadDrafts() {
    const currentProject = getState().project;
    try {
      const draft = await get("orbsie-draft");
      const library = await get<Record<string, Project>>("orbsie-library");
      if (getState().project !== currentProject) return;
      const libraryDrafts = Object.entries(library ?? {}).flatMap(
        ([id, value]) => {
          const parsed = projectSchema.safeParse(value);
          return parsed.success && parsed.data.id === id ? [parsed.data] : [];
        },
      );
      const saved = projectSchema.safeParse(draft?.project);
      const current = saved.success ? saved.data : undefined;
      const preferred = current
        ? (libraryDrafts.find((p) => p.id === current.id) ?? current)
        : undefined;
      setState({
        drafts: [
          ...(preferred ? [preferred] : []),
          ...libraryDrafts.filter((p) => p.id !== preferred?.id),
        ],
      });
    } catch {
      // Keep any existing drafts list; the account modal remains usable.
    }
  },
  async readHistoryFor(project: Project) {
    try {
      const records = await get<Record<string, unknown>>("orbsie-history");
      const history = readLocalHistory(records?.[project.id], project);
      if (history) {
        setState({
          draftHistory: { ...getState().draftHistory, [project.id]: history },
        });
        return history;
      }
    } catch {
      return undefined;
    }
    // The older single-draft record format keeps history on the draft itself.
    try {
      const draft = await get("orbsie-draft");
      const history = readLocalHistory(draft, project);
      if (history) {
        setState({
          draftHistory: { ...getState().draftHistory, [project.id]: history },
        });
        return history;
      }
    } catch {}
    return undefined;
  },
  async resetLocalData() {
    invalidatePendingLoad();
    finishActiveExperience("cancelled");
    clearActiveAuthoringRun();
    active?.abort();
    active = undefined;
    clearGenerationDiagnostics();
    await clear();
    setState({
      drafts: [],
      draftHistory: {},
      recovered: undefined,
      generationRecovery: undefined,
      modelingFeedback: undefined,
      authoringActivity: [],
      reviewContinuation: undefined,
      interruptedReviewContinuation: undefined,
      building: false,
    });
  },
  async load(project, play = false, isCurrent = () => true) {
    const epoch = invalidatePendingLoad();
    const startingProject = getState().project;
    finishActiveExperience("cancelled");
    clearActiveAuthoringRun();
    active?.abort();
    active = undefined;
    let history: LocalHistory | undefined;
    if (!play) {
      history = readLocalHistory(getState().draftHistory[project.id], project);
      if (!history) history = await getState().readHistoryFor(project);
    }
    if (
      epoch !== loadEpoch ||
      getState().project !== startingProject ||
      !isCurrent()
    )
      return false;
    const parsedProject = projectSchema.parse(project);
    const writer = play || activateWriter(project.id);
    const saved = getState().drafts.some(
      (draft) =>
        draft.id === project.id &&
        JSON.stringify(draft) === JSON.stringify(project),
    );
    baseline = parsedProject;
    setState({
      project: parsedProject,
      saved,
      phase: "editing",
      playing: play,
      building: false,
      score: [],
      won: false,
      lost: false,
      gameScore: 0,
      selected: undefined,
      history: history?.history ?? [],
      future: history?.future ?? [],
      recovered: undefined,
      generationRecovery: undefined,
      modelingFeedback: undefined,
      authoringActivity: [],
      reviewContinuation: undefined,
      interruptedReviewContinuation: undefined,
      readOnly: !writer,
      ...(!writer
        ? {
            error:
              "This world is open in another tab. This copy is read-only until that tab closes.",
          }
        : { error: "" }),
    });
    return true;
  },
  collect(id) {
    const s = getState();
    if (!s.score.includes(id)) setState({ score: [...s.score, id] });
  },
  stop() {
    const run = activeAuthoringRun;
    const current = getState();
    if (active && activeReviewActivity?.controller === active) {
      activeReviewActivity.publish(
        "cancelled",
        "Stopped. Finished objects are safe.",
        current.project.revision,
      );
      activeReviewActivity.clear();
      activeReviewActivity = undefined;
    }
    if (
      run &&
      run.controller === active &&
      current.project.id === run.projectId
    )
      run.publish("cancelled", "Stopped. Finished objects are safe.");
    run?.diagnostic.terminal({
      reason: "client-abort",
      abortSource: "client",
      failureCode: "cancelled",
    });
    finishActiveExperience("cancelled");
    clearActiveAuthoringRun();
    active?.abort();
    active = undefined;
    const s = getState();
    const committedWorld = baseline ?? committed(s.project);
    const recovery =
      run && baseline?.revision === run.initialRevision
        ? run.recovery
        : undefined;
    const recoverySelected =
      recovery?.selected &&
      committedWorld.entities.some((entity) => entity.id === recovery.selected)
        ? recovery.selected
        : undefined;
    setState({
      phase:
        recovery?.phase === "landing" || (!recovery && s.phase === "descending")
          ? "editing"
          : (recovery?.phase ?? s.phase),
      building: false,
      project: committedWorld,
      ...(recovery
        ? {
            selected: recoverySelected,
            playing: recovery.playing,
            score: recovery.score,
            won: recovery.won,
            lost: recovery.lost,
            gameScore: recovery.gameScore,
            ruleRestartCount: recovery.ruleRestartCount,
            reset: recovery.reset,
            history: recovery.history,
            future: recovery.future,
          }
        : {}),
      generationRecovery: undefined,
      notice: "Stopped. Finished objects are safe.",
      reviewContinuation: undefined,
      interruptedReviewContinuation: undefined,
    });
    if (
      committedWorld.entities.length > 0 ||
      committedWorld.messages.length > 0
    )
      void getState().save();
  },
  undo() {
    const s = getState();
    if (s.readOnly || s.building || !s.history.length) return;
    setState({
      project: { ...s.history.at(-1)!, revision: s.project.revision + 1 },
      future: [s.project, ...s.future].slice(0, HISTORY_LIMIT),
      history: s.history.slice(0, -1),
      selected: undefined,
      generationRecovery: undefined,
      reviewContinuation: undefined,
      interruptedReviewContinuation: undefined,
      notice: "Previous change restored.",
    });
    void getState().save();
  },
  redo() {
    const s = getState();
    if (s.readOnly || s.building || !s.future.length) return;
    setState({
      project: { ...s.future[0], revision: s.project.revision + 1 },
      history: [...s.history, s.project].slice(-HISTORY_LIMIT),
      future: s.future.slice(1),
      generationRecovery: undefined,
      reviewContinuation: undefined,
      interruptedReviewContinuation: undefined,
    });
    void getState().save();
  },
  async resumeInterruptedReview(connection, journal) {
    const initialState = getState();
    const continuation = initialState.interruptedReviewContinuation;
    if (!continuation) return;
    const initialProject = initialState.project;
    const savedCheckpoint = committed(initialProject, baseline);
    const connectionMatches =
      connection.provider === continuation.provider &&
      connection.model === continuation.model &&
      connection.effort === continuation.effort &&
      browserModelingAvailable() === continuation.browserModeling;
    if (
      initialState.building ||
      initialState.readOnly ||
      !initialState.saved ||
      initialProject.id !== continuation.projectId ||
      initialProject.revision !== continuation.revision ||
      !connectionMatches ||
      !isGenerationReady(connection) ||
      (journal && !journal.isCurrent())
    ) {
      setState({
        error:
          "This saved review can only continue from its original scene and AI connection.",
      });
      return;
    }
    if (!activateWriter(initialProject.id)) {
      setState({
        readOnly: true,
        error:
          "This world is being edited in another tab. Your saved review was not changed.",
      });
      return;
    }
    try {
      const library = await get<Record<string, unknown>>("orbsie-library");
      const stored = projectSchema.safeParse(library?.[initialProject.id]);
      if (
        getState().project !== initialProject ||
        getState().interruptedReviewContinuation !== continuation ||
        !stored.success ||
        JSON.stringify(stored.data) !== JSON.stringify(savedCheckpoint)
      ) {
        setState({
          saved: false,
          error:
            "The saved scene changed before review could resume. Save it again before continuing.",
        });
        return;
      }
    } catch {
      setState({
        error:
          "The saved scene could not be checked before review could resume.",
      });
      return;
    }

    clearActiveAuthoringRun();
    active?.abort();
    const controller = new AbortController();
    const { signal } = controller;
    active = controller;
    let expectedProject = initialProject;
    let latestSavedProject = savedCheckpoint;
    let admittedRunId: string | undefined;
    let reviewAttempted = false;
    let refreshPriorRunId = false;
    let responseOutcomeUnknown: "start" | "review" | undefined;
    let reviewImageSupported = continuation.reviewImageSupported;
    let durableRun: GenerationRun | undefined;
    let assetPolicy = deriveAssetPolicy(
      continuation.prompt,
      continuation.selected,
      savedCheckpoint,
    );
    const clientRunId = crypto.randomUUID();
    const recoveryActivityThrottle = createAuthoringActivityThrottle(
      (event) => {
        if (signal.aborted || active !== controller) return;
        setState((state) => {
          if (state.project.id !== continuation.projectId) return state;
          const activity: AuthoringActivity = {
            id: crypto.randomUUID(),
            runId: event.runId,
            projectId: event.projectId,
            revision: Number.isInteger(event.revision)
              ? event.revision
              : state.project.revision,
            kind: event.kind,
            message: event.message,
            at: Date.now(),
          };
          return {
            ...state,
            authoringActivity: appendAuthoringActivity(
              state.authoringActivity,
              activity,
            ),
          };
        });
      },
    );
    const publishRecoveryActivity = (
      kind: AuthoringActivityKind,
      message: string,
      revision: number,
    ) =>
      recoveryActivityThrottle.publish({
        runId: clientRunId,
        projectId: continuation.projectId,
        revision,
        kind,
        message,
      });
    activeReviewActivity = {
      controller,
      publish: publishRecoveryActivity,
      clear: recoveryActivityThrottle.clear,
    };
    const currentAt = (revision?: number) => {
      const state = getState();
      return (
        !signal.aborted &&
        active === controller &&
        state.project === expectedProject &&
        state.project.id === continuation.projectId &&
        (revision === undefined || state.project.revision === revision) &&
        state.interruptedReviewContinuation === continuation &&
        !state.readOnly &&
        activateWriter(continuation.projectId) &&
        (!journal || journal.isCurrent())
      );
    };
    const persistCurrent = async (revision: number) => {
      if (!currentAt(revision)) return false;
      const snapshot = committed(getState().project, baseline);
      await getState().save();
      if (!currentAt(revision) || !getState().saved) return false;
      const library = await get<Record<string, unknown>>("orbsie-library");
      const stored = projectSchema.safeParse(library?.[snapshot.id]);
      if (
        !stored.success ||
        JSON.stringify(stored.data) !== JSON.stringify(snapshot)
      ) {
        setState({ saved: false });
        return false;
      }
      baseline = snapshot;
      latestSavedProject = snapshot;
      return true;
    };
    const appendReviewMessage = (revision: number, message: string) => {
      setState((state) => {
        if (
          state.project !== expectedProject ||
          state.project.revision !== revision ||
          state.project.messages.length >= PROJECT_MESSAGE_LIMIT
        )
          return state;
        const project = {
          ...state.project,
          messages: [
            ...state.project.messages,
            { role: "assistant" as const, text: message },
          ],
        };
        expectedProject = project;
        return { ...state, project, saved: false };
      });
    };
    const captureEvidence = async (
      reviewed: Project,
    ): Promise<AuthoringReviewEvidence> => {
      if (!currentAt(reviewed.revision))
        throw Error("The scene review is stale.");
      const capture = await captureSceneReview({
        projectId: reviewed.id,
        revision: reviewed.revision,
        timeoutMs: 10_000,
        ...(connection.renderer === "webgl" ||
        connection.renderer === "software"
          ? { renderer: connection.renderer }
          : {}),
        signal,
      });
      if (!currentAt(reviewed.revision))
        throw Error("The scene review is stale.");
      return {
        structuralObservations: sceneReviewObservationsFromCapture(capture),
        reviewImage: {
          projectId: capture.projectId,
          revision: capture.revision,
          renderer: capture.renderer,
          width: capture.width,
          height: capture.height,
          image: capture.image,
        },
      } satisfies AuthoringReviewEvidence;
    };

    setState({ building: true, error: "", saved: true });
    try {
      // Capture the exact saved revision before admission, so a capture error
      // cannot consume a review-only run.
      let reviewed = committed(getState().project, baseline);
      const firstEvidence = await captureEvidence(reviewed);
      if (!currentAt(reviewed.revision)) return;
      const startRequest = authoringReviewStartRequest(
        connection,
        {
          priorRunId: continuation.priorRunId,
          prompt: continuation.prompt,
          project: reviewed,
          ...(continuation.selected ? { selected: continuation.selected } : {}),
          browserModeling: continuation.browserModeling,
        },
        clientRunId,
      );
      let startResponse: Response;
      try {
        startResponse = await fetch(startRequest.url, {
          ...startRequest.init,
          signal,
        });
      } catch {
        responseOutcomeUnknown = "start";
        throw Error("The review start response was lost.");
      }
      if (!currentAt(reviewed.revision)) return;
      const startBody = await startResponse.json().catch(() => ({}));
      if (!startResponse.ok)
        throw Error(
          typeof startBody?.error === "string"
            ? startBody.error
            : "The saved review could not be resumed.",
        );
      admittedRunId = validatedClientRunId(startBody?.runId);
      if (
        !admittedRunId ||
        typeof startBody?.reviewImageSupported !== "boolean"
      )
        throw Error("The saved review could not be resumed.");
      reviewImageSupported = startBody.reviewImageSupported;
      if (reviewImageSupported !== continuation.reviewImageSupported)
        throw Error(
          "The review capabilities changed. Reconnect the original model before continuing.",
        );
      publishRecoveryActivity(
        "waiting",
        "Reviewing the saved scene…",
        reviewed.revision,
      );
      const reviewScope = () =>
        reviewImageSupported
          ? ("visual+structural" as const)
          : ("structural-only" as const);
      const requestReview = async (
        phase: "review" | "final-review",
        project: Project,
        evidence: AuthoringReviewEvidence,
        feedback?: string,
      ) => {
        if (!admittedRunId || !currentAt(project.revision))
          throw Error("The scene review is unavailable.");
        const request = authoringReviewRequest(
          connection,
          {
            runId: admittedRunId,
            phase,
            prompt: continuation.prompt,
            project,
            ...(continuation.selected
              ? { selected: continuation.selected }
              : {}),
            browserModeling: continuation.browserModeling,
            structuralObservations: evidence.structuralObservations,
            ...(reviewImageSupported
              ? { reviewImage: evidence.reviewImage }
              : {}),
            ...(feedback ? { feedback } : {}),
          },
          clientRunId,
        );
        reviewAttempted = true;
        let response: Response;
        try {
          response = await fetch(request.url, { ...request.init, signal });
        } catch {
          responseOutcomeUnknown = "review";
          throw Error("The review response was lost.");
        }
        if (!currentAt(project.revision))
          throw Error("The scene review is stale.");
        if (
          !response.ok &&
          response.headers.get("X-Orbsie-Review-Failure-Kind")
        )
          refreshPriorRunId = true;
        const body = await response.json().catch(() => ({}));
        if (!response.ok)
          throw Error(
            typeof body?.error === "string"
              ? body.error
              : "The scene review could not be completed.",
          );
        refreshPriorRunId = true;
        const parsed = parseAuthoringReviewResponse(body, {
          projectId: project.id,
          revision: project.revision,
          phase,
          scope: reviewScope(),
          browserModeling: continuation.browserModeling,
          entityIds: project.entities.map((entity) => entity.id),
        });
        return parsed;
      };

      let partialIssue: string | undefined;
      let reviewIncomplete = false;
      const workflow = await runAuthoringReviewWorkflow({
        project: () => committed(getState().project, baseline),
        isCurrent: currentAt,
        isSaved: () => getState().saved,
        initialEvidence: firstEvidence,
        capture: captureEvidence,
        request: requestReview,
        onStarted: () => undefined,
        publish: (message, revision) =>
          publishRecoveryActivity("waiting", message, revision),
        appendFinding: (revision, issue) =>
          appendReviewMessage(revision, `The review found: ${issue}`),
        appendFinalFinding: async (revision, issue) => {
          appendReviewMessage(
            revision,
            `The final review still found: ${issue}`,
          );
          if (!(await persistCurrent(revision)))
            throw Error("The reviewed scene could not be saved.");
        },
        applyCorrections: async ({ project: reviewed, result }) => {
          publishRecoveryActivity(
            "applied",
            "Applying a targeted correction to the scene…",
            reviewed.revision,
          );
          assetPolicy = deriveAssetPolicy(
            continuation.prompt,
            continuation.selected,
            reviewed,
          );
          if (!(await persistCurrent(reviewed.revision)))
            throw Error("The reviewed scene could not be saved.");
          const reviewedWithFinding = committed(getState().project, baseline);
          const correctionRunId = crypto.randomUUID();
          if (journal) {
            durableRun = await journal.begin(
              reviewedWithFinding,
              correctionRunId,
              continuation.prompt,
              continuation.selected,
            );
            if (!currentAt(reviewed.revision)) return undefined;
          }
          let cursor: Cursor = {
            runId: correctionRunId,
            sequence: 0,
            seen: new Set(),
          };
          let working = reviewedWithFinding;
          for (const input of result.corrections) {
            if (!currentAt()) throw Error("The scene review is stale.");
            const modelCommand = enforceAssetPolicy(
              working,
              parseModelCommandForProcessing(
                input,
                false,
                continuation.browserModeling,
              ),
              assetPolicy,
            );
            assertModelingCommand(
              modelCommand,
              false,
              continuation.browserModeling,
            );
            let command: Command;
            if (
              modelCommand.type === "set_geometry" &&
              modelCommand.geometry.kind === "generated"
            ) {
              const id = modelCommand.id;
              const job = modelCommand.geometry.job;
              if (!("backend" in job))
                throw Error(
                  "This modeling job is unsupported. Request a browser-manifold recipe instead.",
                );
              let recipe: BrowserModelRecipe;
              let authoring:
                | {
                    source: ReturnType<typeof canonicalBrowserProceduralSource>;
                    sourceHash: string;
                  }
                | undefined;
              if (job.backend === "browser-procedural") {
                const source = canonicalBrowserProceduralSource(job.source);
                const sourceHash = await hashBrowserProceduralSource(source);
                recipe = await evaluateBrowserProceduralInWorker(source, {
                  signal,
                });
                if (!currentAt()) throw Error("The scene review is stale.");
                authoring = { source, sourceHash };
              } else recipe = job.recipe;
              const model = await buildBrowserModel(recipe, {
                signal,
                color:
                  working.entities.find((entity) => entity.id === id)?.color ??
                  "#6ead60",
              });
              if (!currentAt()) throw Error("The scene review is stale.");
              command = commandSchema.parse({
                ...modelCommand,
                geometry: {
                  ...modelCommand.geometry,
                  job:
                    authoring === undefined
                      ? { backend: "browser-manifold", recipe }
                      : {
                          backend: "browser-manifold",
                          recipe,
                          authoring,
                        },
                  model,
                },
              });
            } else command = commandSchema.parse(modelCommand);
            const envelope = {
              version: 1 as const,
              projectId: working.id,
              runId: cursor.runId,
              sequence: cursor.sequence + 1,
              operationId: crypto.randomUUID(),
              baseRevision: working.revision,
              command,
            };
            const applied = applyOperation(working, envelope, cursor);
            working = applied.project;
            cursor = applied.cursor;
            if (journal && durableRun) {
              if (
                command.type === "set_geometry" &&
                command.geometry.kind === "generated" &&
                !(await uploadCloudGeneratedModels(working, () => currentAt()))
              )
                throw Error("The scene review is stale.");
              const acknowledged = await appendCloudGenerationOperation(
                envelope,
                signal,
              );
              if (!currentAt()) throw Error("The scene review is stale.");
              if (
                JSON.stringify(acknowledged.checkpoint) !==
                JSON.stringify(projectSchema.parse(working))
              )
                throw Error(
                  "The cloud checkpoint differs from this update. Recover it before continuing.",
                );
              durableRun = acknowledged;
            }
            if (command.type === "commit_revision")
              baseline = committed(working, baseline);
            expectedProject = working;
            setState({
              project: working,
              saved: false,
              ...(command.type === "commit_revision" ? { future: [] } : {}),
            });
            if (command.type === "commit_revision") {
              if (!(await persistCurrent(working.revision)))
                throw Error("The reviewed scene could not be saved.");
            }
          }
          return committed(getState().project, baseline);
        },
      });
      partialIssue = workflow.partialIssue;
      reviewIncomplete = workflow.incomplete;
      if (reviewIncomplete)
        throw Error("Scene saved, but review could not finish.");
      if (!currentAt()) return;
      if (
        !getState().saved ||
        JSON.stringify(getState().project) !==
          JSON.stringify(latestSavedProject)
      ) {
        if (!(await persistCurrent(getState().project.revision)))
          throw Error("The reviewed scene could not be saved.");
      }
      publishRecoveryActivity(
        "completed",
        partialIssue
          ? `The correction was applied; the final review still found: ${partialIssue}`
          : reviewImageSupported
            ? "Scene verified. Changes are applied."
            : "Scene structure verified. Changes are applied.",
        getState().project.revision,
      );
      setState({
        building: false,
        error: "",
        notice: partialIssue
          ? `The correction was applied; the final review still found: ${partialIssue}`
          : reviewIncomplete
            ? "Scene saved, but review could not finish."
            : reviewImageSupported
              ? "Scene verified. Changes are applied."
              : "Scene structure verified. Changes are applied.",
        interruptedReviewContinuation: undefined,
        reviewContinuation:
          partialIssue === undefined
            ? undefined
            : {
                projectId: continuation.projectId,
                revision: getState().project.revision,
                issue: partialIssue,
              },
      });
    } catch (error) {
      if (signal.aborted || active !== controller) return;
      if (
        getState().project !== expectedProject ||
        getState().project.id !== continuation.projectId ||
        getState().interruptedReviewContinuation !== continuation
      )
        return;
      baseline = latestSavedProject;
      expectedProject = latestSavedProject;
      let savedCheckpointCurrent = false;
      try {
        const library = await get<Record<string, unknown>>("orbsie-library");
        const stored = projectSchema.safeParse(
          library?.[latestSavedProject.id],
        );
        savedCheckpointCurrent =
          stored.success &&
          JSON.stringify(stored.data) === JSON.stringify(latestSavedProject);
      } catch {}
      const refreshContinuation =
        admittedRunId &&
        reviewAttempted &&
        refreshPriorRunId &&
        savedCheckpointCurrent &&
        getState().project.id === latestSavedProject.id;
      const refreshed = refreshContinuation
        ? {
            ...continuation,
            revision: latestSavedProject.revision,
            priorRunId: admittedRunId!,
            reviewImageSupported,
          }
        : continuation;
      publishRecoveryActivity(
        "failed",
        "Scene saved, but review could not finish.",
        latestSavedProject.revision,
      );
      setState({
        project: latestSavedProject,
        saved: savedCheckpointCurrent,
        building: false,
        interruptedReviewContinuation: savedCheckpointCurrent
          ? refreshed
          : undefined,
        error:
          responseOutcomeUnknown === "start"
            ? "The review start response was lost. Your scene is saved, but admission is unknown; retrying may conflict with a review already in progress."
            : responseOutcomeUnknown === "review"
              ? "The review response was lost. Your scene is saved, but admission is unknown; retrying may conflict with a review already in progress."
              : error instanceof Error &&
                  [
                    "The saved scene changed before review could resume. Save it again before continuing.",
                    "The review capabilities changed. Reconnect the original model before continuing.",
                  ].includes(error.message)
                ? error.message
                : "Scene saved, but review could not finish. Your world is safe.",
        notice: "",
      });
    } finally {
      recoveryActivityThrottle.clear();
      if (activeReviewActivity?.controller === controller)
        activeReviewActivity = undefined;
      if (durableRun?.state === "running")
        void cancelCloudGenerationRun(durableRun.id).catch(() => undefined);
      if (active === controller) {
        active = undefined;
        setState({ building: false });
      }
    }
  },
  async run(
    prompt,
    connection = { provider: "free", model: "", key: "" },
    journal,
    generationFeedback,
  ) {
    if (!activateWriter(getState().project.id)) {
      setState({
        readOnly: true,
        error:
          "This world is being edited in another tab. Your local copy was not changed.",
      });
      return;
    }
    const stateBeforeRun = getState();
    const preservedUiState = {
      phase: stateBeforeRun.phase,
      selected: stateBeforeRun.selected,
      playing: stateBeforeRun.playing,
      score: stateBeforeRun.score,
      won: stateBeforeRun.won,
      lost: stateBeforeRun.lost,
      gameScore: stateBeforeRun.gameScore,
      ruleRestartCount: stateBeforeRun.ruleRestartCount,
      reset: stateBeforeRun.reset,
      history: stateBeforeRun.history,
      future: stateBeforeRun.future,
    };
    finishActiveExperience("cancelled");
    clearActiveAuthoringRun();
    active?.abort();
    active = undefined;
    const controller = new AbortController();
    active = controller;
    const { signal } = controller;
    const before =
      stateBeforeRun.phase === "landing"
        ? blankProject()
        : committed(stateBeforeRun.project, baseline);
    const retryFeedback = generationFeedbackMatchesProject(
      generationFeedback,
      before.id,
    )
      ? generationFeedback
      : undefined;
    const ruleRestartsBeforeGeneration = getState().ruleRestartCount;
    baseline = before;
    const initial = before.entities.length === 0;
    const selected = initial ? undefined : stateBeforeRun.selected;
    let assetPolicy = deriveAssetPolicy(prompt, selected, before);
    const browserModeling = browserModelingAvailable();
    const reviewEnabled =
      (connection as GenerationConnection & { authoringReview?: boolean })
        .authoringReview === true;
    const project = {
      ...before,
      title: initial ? draftTitleFromPrompt(prompt) : before.title,
      messages: [
        ...before.messages,
        {
          role: "user" as const,
          text: prompt,
          ...(selected ? { entityId: selected } : {}),
        },
      ],
    };
    const experienceToken = beginExperience(project.id);
    activeExperience = { projectId: project.id, token: experienceToken };
    let experienceFinished = false;
    const finishRunExperience = (
      outcome: "success" | "error" | "cancelled",
    ) => {
      if (experienceFinished) return;
      experienceFinished = true;
      finishExperience(project.id, experienceToken, outcome);
      if (activeExperience?.token === experienceToken)
        activeExperience = undefined;
    };
    const settleWithoutRenderer = () => {
      if (!initial || parcelTransitionController.hasRenderer) return;
      // A test or unsupported-renderer fallback has no render loop that can
      // report the visual handoff. Let the current async turn finish first,
      // then expose the workspace without inventing a visual completion time.
      void Promise.resolve().then(() => {
        queueMicrotask(() => {
          if (
            !signal.aborted &&
            !parcelTransitionController.hasRenderer &&
            getState().project.id === project.id &&
            getState().phase === "descending"
          )
            setState({ phase: "editing" });
        });
      });
    };
    const runId = crypto.randomUUID();
    const diagnosticProvider =
      connection.provider === "chatgpt-hosted"
        ? "chatgpt"
        : connection.provider === "openrouter" ||
            connection.provider === "gateway" ||
            connection.provider === "free"
          ? connection.provider
          : "free";
    const diagnostic = beginClientGenerationDiagnostic({
      runId,
      provider: diagnosticProvider,
      quality: connection.quality,
      reasoningEffort:
        connection.effort === "low" ||
        connection.effort === "medium" ||
        connection.effort === "high"
          ? connection.effort
          : undefined,
      serviceTier: connection.provider === "free" ? undefined : "default",
      renderer: connection.renderer,
      capabilities:
        typeof navigator === "undefined"
          ? undefined
          : {
              touch: navigator.maxTouchPoints > 0,
              coarsePointer:
                typeof window !== "undefined" &&
                window.matchMedia?.("(pointer: coarse)").matches === true,
              online: navigator.onLine !== false,
            },
      initialRevision: project.revision,
    });
    let activityThrottle: ReturnType<typeof createAuthoringActivityThrottle>;
    const publishActivity = (
      kind: AuthoringActivityKind,
      message: string,
      revision = getState().project.revision,
    ) => {
      const event: AuthoringActivityDraft = {
        runId,
        projectId: project.id,
        revision,
        kind,
        message,
      };
      activityThrottle.publish(event);
    };
    activityThrottle = createAuthoringActivityThrottle((event) => {
      if (signal.aborted || active !== controller) return;
      setState((state) => {
        if (
          signal.aborted ||
          active !== controller ||
          activeAuthoringRun?.controller !== controller ||
          activeAuthoringRun.runId !== runId ||
          state.project.id !== project.id
        )
          return state;
        const activity: AuthoringActivity = {
          id: crypto.randomUUID(),
          runId: event.runId,
          projectId: event.projectId,
          revision: Number.isInteger(event.revision)
            ? event.revision
            : state.project.revision,
          kind: event.kind,
          message: event.message,
          at: Date.now(),
        };
        return {
          ...state,
          authoringActivity: appendAuthoringActivity(
            state.authoringActivity,
            activity,
          ),
        };
      });
    });
    activeAuthoringRun = {
      controller,
      runId,
      projectId: project.id,
      diagnostic,
      recovery: preservedUiState,
      initialRevision: before.revision,
      publish: publishActivity,
      clear: activityThrottle.clear,
    };
    setState({
      project,
      phase: initial ? "descending" : "editing",
      ...(initial ? { score: [], won: false, selected: undefined } : {}),
      building: true,
      error: "",
      generationErrorCode: undefined,
      generationRecovery: undefined,
      reviewContinuation: undefined,
      interruptedReviewContinuation: undefined,
      notice: "",
      saved: false,
      authoringActivity: [],
    });
    publishActivity("waiting", "Waiting for a response…", project.revision);
    let cursor: Cursor = {
      runId,
      sequence: 0,
      seen: new Set(),
    };
    let durableRun: GenerationRun | undefined;
    let failureFeedback: GenerationFeedback | undefined;
    const journalCurrent = () =>
      !signal.aborted &&
      active === controller &&
      (!journal || journal.isCurrent());
    const cancelDurable = () => {
      if (durableRun?.state === "running")
        void cancelCloudGenerationRun(durableRun.id).catch(() => undefined);
    };
    signal.addEventListener("abort", cancelDurable, { once: true });
    const recordClientAbort = () =>
      diagnostic.terminal({
        reason: "client-abort",
        abortSource: "client",
        failureCode: "cancelled",
      });
    signal.addEventListener("abort", recordClientAbort, { once: true });
    let lastAppliedCommand: Command["type"] | undefined;
    let streamEnded = false;
    let streamErrorRecord = false;
    let streamFailure: GenerationStreamFailureReason | undefined;
    let observationLimit = false;
    let parserFailure = false;
    let applyFailure = false;
    let journalFailure = false;
    let providerTimeout = false;
    let providerFinishReason:
      | "stop"
      | "length"
      | "tool_calls"
      | "content_filter"
      | "error"
      | "other"
      | undefined;
    let authoringRunId: string | undefined;
    let reviewImageSupported = false;
    let reviewStarted = false;
    let reviewRequestFailed = false;
    let reviewIncomplete = false;
    let reviewPartial = false;
    let reviewRemainingIssue: string | undefined;
    let reviewContinuationRevision: number | undefined;
    const writerCurrent = () =>
      !getState().readOnly && activateWriter(project.id);
    const apply = async (input: ModelCommand) => {
      if (signal.aborted || active !== controller || !writerCurrent())
        return false;
      let s = getState();
      let modelCommand: ModelCommand;
      try {
        modelCommand = enforceAssetPolicy(
          s.project,
          parseModelCommandForProcessing(input, false, browserModeling),
          assetPolicy,
        );
        assertModelingCommand(modelCommand, false, browserModeling);
      } catch (error) {
        applyFailure = true;
        throw error;
      }
      let command: Command;
      if (modelCommand.type === "reserve_entity")
        publishActivity(
          "constructing",
          `Building ${authoringEntityLabel(modelCommand.entity.label)}…`,
          s.project.revision,
        );
      if (
        modelCommand.type === "set_geometry" &&
        modelCommand.geometry.kind === "generated"
      ) {
        const entityId = modelCommand.id;
        publishActivity(
          "preparing",
          `Preparing ${authoringEntityLabel(s.project.entities.find((entity) => entity.id === entityId)?.label)} geometry…`,
          s.project.revision,
        );
        const job = modelCommand.geometry.job;
        if (!("backend" in job))
          throw Error(
            "This modeling job is unsupported. Request a browser-manifold recipe instead.",
          );
        let recipe: BrowserModelRecipe;
        let authoring:
          | {
              source: ReturnType<typeof canonicalBrowserProceduralSource>;
              sourceHash: string;
            }
          | undefined;
        let model: Awaited<ReturnType<typeof buildBrowserModel>>;
        try {
          if (job.backend === "browser-procedural") {
            const source = canonicalBrowserProceduralSource(job.source);
            const sourceHash = await hashBrowserProceduralSource(source);
            recipe = await evaluateBrowserProceduralInWorker(source, {
              signal,
            });
            if (signal.aborted || active !== controller) return false;
            authoring = { source, sourceHash };
          } else {
            recipe = job.recipe;
          }
          model = await buildBrowserModel(recipe, {
            signal,
            color:
              s.project.entities.find((entity) => entity.id === entityId)
                ?.color ?? "#6ead60",
          });
        } catch (error) {
          applyFailure = true;
          if (!signal.aborted && active === controller)
            setState({
              modelingFeedback: modelingFeedbackForFailure({
                projectId: project.id,
                entityId,
                backend: job.backend,
                ...(job.backend === "browser-manifold"
                  ? { recipe: job.recipe }
                  : {}),
                error,
              }),
            });
          throw error;
        }
        if (signal.aborted || active !== controller || !writerCurrent())
          return false;
        command = commandSchema.parse({
          ...modelCommand,
          geometry: {
            ...modelCommand.geometry,
            job:
              authoring === undefined
                ? { backend: "browser-manifold", recipe }
                : {
                    backend: "browser-manifold",
                    recipe,
                    authoring,
                  },
            model,
          },
        });
        s = getState();
      } else command = commandSchema.parse(modelCommand);
      diagnostic.noteCommand(command.type);
      const envelope = {
        version: 1 as const,
        projectId: s.project.id,
        runId: cursor.runId,
        sequence: cursor.sequence + 1,
        operationId: crypto.randomUUID(),
        baseRevision: s.project.revision,
        command,
      };
      let result: ReturnType<typeof applyOperation>;
      try {
        result = applyOperation(s.project, envelope, cursor);
      } catch (error) {
        // A parsed command can still fail against the current scene (for
        // example, a setter targeting an object that no longer exists). Keep
        // that semantic validation failure distinct from a broken stream.
        applyFailure = true;
        throw error;
      }
      if (journal && durableRun) {
        try {
          if (!journalCurrent()) return false;
          if (
            command.type === "set_geometry" &&
            command.geometry.kind === "generated" &&
            !(await uploadCloudGeneratedModels(result.project, journalCurrent))
          )
            return false;
          const acknowledged = await appendCloudGenerationOperation(
            envelope,
            signal,
          );
          if (!journalCurrent()) return false;
          if (
            JSON.stringify(acknowledged.checkpoint) !==
            JSON.stringify(projectSchema.parse(result.project))
          )
            throw Error(
              "The cloud checkpoint differs from this update. Recover it before continuing.",
            );
          durableRun = acknowledged;
        } catch (error) {
          journalFailure = true;
          streamFailure = "completion-record-failure";
          throw error;
        }
      }
      if (command.type === "commit_revision")
        baseline = committed(result.project, baseline);
      cursor = result.cursor;
      lastAppliedCommand = command.type;
      if (command.type === "commit_revision")
        diagnostic.commit(result.project.revision);
      const updatedId =
        command.type === "reserve_entity"
          ? command.entity.id
          : command.type === "set_geometry" ||
              command.type === "set_material" ||
              command.type === "set_transform" ||
              command.type === "set_behavior"
            ? command.id
            : undefined;
      const updatedEntity = updatedId
        ? result.project.entities.find((entity) => entity.id === updatedId)
        : undefined;
      if (updatedEntity)
        noteSceneUpdate(project.id, updatedEntity, experienceToken);
      if (
        command.type === "set_group_transform" ||
        command.type === "set_parent"
      ) {
        // Parent edits redraw stable child entities without replacing geometry.
        const groups = new Map(
          (result.project.groups ?? []).map((group) => [group.id, group]),
        );
        for (const entity of result.project.entities) {
          let parentId = entity.parentId;
          let affected = entity.id === command.id;
          for (let depth = 0; parentId && depth < 32; depth++) {
            if (parentId === command.id) {
              affected = true;
              break;
            }
            parentId = groups.get(parentId)?.parentId;
          }
          if (affected) noteSceneUpdate(project.id, entity, experienceToken);
        }
      }
      setState({
        project: result.project,
        ...(command.type === "commit_revision"
          ? {
              history: [...preservedUiState.history, before].slice(
                -HISTORY_LIMIT,
              ),
              future: [],
            }
          : {}),
      });
      if (command.type === "reserve_entity")
        publishActivity(
          "applied",
          `${authoringEntityLabel(command.entity.label)} is taking shape.`,
          result.project.revision,
        );
      else if (command.type === "set_geometry")
        publishActivity(
          "applied",
          `Applied the shape for ${authoringEntityLabel(updatedEntity?.label)}.`,
          result.project.revision,
        );
      else if (command.type === "commit_revision")
        publishActivity(
          "applied",
          "Applied the final scene update.",
          result.project.revision,
        );
      else if (updatedEntity)
        publishActivity(
          "applied",
          `Applied a change to ${authoringEntityLabel(updatedEntity.label)}.`,
          result.project.revision,
        );
      else if (command.type === "set_game")
        publishActivity(
          "applied",
          "Applied the world rules.",
          result.project.revision,
        );
      else if (command.type === "set_environment")
        publishActivity(
          "applied",
          "Applied the world atmosphere.",
          result.project.revision,
        );
      if (command.type === "reserve_entity")
        noteReservation(project.id, command.entity.id, experienceToken);
      if (command.type === "commit_revision") await getState().save();
      return !signal.aborted && active === controller;
    };
    const currentAt = (revision?: number) =>
      !signal.aborted &&
      active === controller &&
      getState().project.id === project.id &&
      (revision === undefined || getState().project.revision === revision) &&
      writerCurrent() &&
      journalCurrent();
    const appendReviewMessage = (revision: number, message: string) => {
      setState((state) => {
        if (
          state.project.id !== project.id ||
          state.project.revision !== revision ||
          state.project.messages.length >= PROJECT_MESSAGE_LIMIT
        )
          return state;
        return {
          ...state,
          project: {
            ...state.project,
            messages: [
              ...state.project.messages,
              { role: "assistant" as const, text: message },
            ],
          },
          saved: false,
        };
      });
    };
    const reviewScope = () =>
      reviewImageSupported
        ? ("visual+structural" as const)
        : ("structural-only" as const);
    const reviewEvidence = async (reviewed: Project) => {
      if (!currentAt(reviewed.revision))
        throw Error("The scene review is stale.");
      const capture = await captureSceneReview({
        projectId: reviewed.id,
        revision: reviewed.revision,
        // A forming mesh can settle just after the default five-second window
        // on slower browser renderers; keep the review tied to this revision.
        timeoutMs: 10_000,
        ...(connection.renderer === "webgl" ||
        connection.renderer === "software"
          ? { renderer: connection.renderer }
          : {}),
        signal,
      });
      if (!currentAt(reviewed.revision))
        throw Error("The scene review is stale.");
      const structuralObservations =
        sceneReviewObservationsFromCapture(capture);
      return {
        structuralObservations,
        ...(reviewImageSupported
          ? {
              reviewImage: {
                projectId: capture.projectId,
                revision: capture.revision,
                renderer: capture.renderer,
                width: capture.width,
                height: capture.height,
                image: capture.image,
              },
            }
          : {}),
      };
    };
    const requestReview = async (
      phase: "review" | "final-review",
      reviewed: Project,
      evidence: AuthoringReviewEvidence,
      feedback?: string,
    ) => {
      if (!authoringRunId || !currentAt(reviewed.revision))
        throw Error("The scene review is unavailable.");
      const request = authoringReviewRequest(
        connection,
        {
          runId: authoringRunId,
          phase,
          prompt,
          project: reviewed,
          selected,
          browserModeling,
          structuralObservations: evidence.structuralObservations,
          ...(evidence.reviewImage
            ? { reviewImage: evidence.reviewImage }
            : {}),
          ...(feedback ? { feedback } : {}),
        },
        runId,
      );
      reviewRequestFailed = true;
      const response = await fetch(request.url, {
        ...request.init,
        signal,
      });
      if (!currentAt(reviewed.revision))
        throw Error("The scene review is stale.");
      const body = await response.json().catch(() => ({}));
      if (!response.ok)
        throw Error(
          typeof body?.error === "string"
            ? body.error
            : "The scene review could not be completed.",
        );
      const parsed = parseAuthoringReviewResponse(body, {
        projectId: reviewed.id,
        revision: reviewed.revision,
        phase,
        scope: reviewScope(),
        browserModeling,
        entityIds: reviewed.entities.map((entity) => entity.id),
      });
      reviewRequestFailed = false;
      return parsed;
    };
    const finishReviewedRun = async (
      message: string,
      kind: AuthoringActivityKind = "completed",
      continuationIssue?: string,
      continuationRevision?: number,
    ) => {
      if (!currentAt(continuationRevision)) return;
      await getState().save();
      if (!currentAt(continuationRevision) || !getState().saved)
        throw Error("The reviewed scene could not be saved.");
      markExperience(project.id, "generationComplete", experienceToken);
      finishRunExperience("success");
      setState({
        reviewContinuation:
          continuationIssue !== undefined && continuationRevision !== undefined
            ? {
                projectId: project.id,
                revision: continuationRevision,
                issue: continuationIssue,
              }
            : undefined,
        interruptedReviewContinuation: undefined,
      });
      publishActivity(kind, message, getState().project.revision);
      setState({
        building: false,
        notice:
          getState().ruleRestartCount !== ruleRestartsBeforeGeneration
            ? GAME_RULES_RESTART_NOTICE
            : "Your world is saved on this device.",
        generationRecovery: undefined,
        modelingFeedback: undefined,
      });
      diagnostic.terminal({ reason: "completed" });
      settleWithoutRenderer();
    };
    const runAuthoringReview = async () => {
      if (!reviewEnabled) return true;
      if (!authoringRunId) {
        reviewIncomplete = true;
        return false;
      }
      const outcome = await runAuthoringReviewWorkflow({
        project: () => committed(getState().project, baseline),
        isCurrent: currentAt,
        isSaved: () => getState().saved,
        capture: reviewEvidence,
        request: requestReview,
        onStarted: () => {
          reviewStarted = true;
        },
        publish: (message, revision) =>
          publishActivity("waiting", message, revision),
        appendFinding: (revision, issue) =>
          appendReviewMessage(revision, `The review found: ${issue}`),
        appendFinalFinding: (revision, issue) =>
          appendReviewMessage(
            revision,
            `The final review still found: ${issue}`,
          ),
        applyCorrections: async ({ project: reviewed, result }) => {
          // Each correction pass gets a saved finding and its own cloud segment.
          assetPolicy = deriveAssetPolicy(prompt, selected, reviewed);
          await getState().save();
          if (!currentAt(reviewed.revision) || !getState().saved)
            throw Error("The reviewed scene could not be saved.");
          const reviewedWithFinding = committed(getState().project, baseline);
          const correctionRunId = crypto.randomUUID();
          if (journal) {
            try {
              durableRun = await journal.begin(
                reviewedWithFinding,
                correctionRunId,
                prompt,
                selected,
              );
              if (!currentAt(reviewed.revision)) return undefined;
            } catch (error) {
              journalFailure = true;
              streamFailure = "completion-record-failure";
              throw error;
            }
          }
          cursor = { runId: correctionRunId, sequence: 0, seen: new Set() };
          publishActivity(
            "applied",
            "Applying a targeted correction to the scene…",
            reviewed.revision,
          );
          for (const correction of result.corrections) {
            if (!(await apply(correction))) return undefined;
          }
          return committed(getState().project, baseline);
        },
      });
      reviewIncomplete = outcome.incomplete;
      reviewRemainingIssue = outcome.partialIssue;
      reviewPartial = outcome.partialIssue !== undefined;
      reviewContinuationRevision = outcome.revision;
      return !reviewIncomplete && !reviewPartial;
    };
    try {
      if (journal) {
        if (!journalCurrent()) return;
        try {
          durableRun = await journal.begin(
            project,
            cursor.runId,
            prompt,
            selected,
          );
        } catch (error) {
          journalFailure = true;
          streamFailure = "completion-record-failure";
          throw error;
        }
        if (!journalCurrent()) {
          cancelDurable();
          return;
        }
      }
      {
        diagnostic.phase("provider-start");
        const request = generationRequest(
          connection,
          {
            prompt,
            project,
            selected,
            localModeling: false,
            browserModeling,
            authoringReview: reviewEnabled,
            modelingFeedback:
              getState().modelingFeedback?.projectId === project.id
                ? getState().modelingFeedback
                : undefined,
            generationFeedback: retryFeedback,
          },
          { clientRunId: runId },
        );
        if (typeof request.init.body === "string")
          diagnostic.noteInputBytes(
            new TextEncoder().encode(request.init.body).byteLength,
          );
        const response = await fetch(request.url, { ...request.init, signal });
        diagnostic.requestId(response.headers.get("X-Orbsie-Request-Id"));
        if (reviewEnabled) {
          authoringRunId = validatedClientRunId(
            response.headers.get(AUTHORING_RUN_HEADER),
          );
          reviewImageSupported =
            response.headers.get(REVIEW_IMAGE_HEADER) === "1";
        }
        diagnostic.phase("response-headers");
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          streamFailure = "provider-error";
          failureFeedback = generationFeedbackForFailure(project.id, body);
          if (failureFeedback?.finishReason)
            providerFinishReason = failureFeedback.finishReason;
          const failureCode =
            response.status === 402 || response.status === 429
              ? "quota"
              : response.status === 401
                ? "connection-required"
                : response.status >= 500
                  ? "host-unavailable"
                  : response.status === 400
                    ? "invalid-input"
                    : "provider-rejected";
          diagnostic.terminal({
            reason: "provider-error",
            failureCode,
            httpStatus: response.status,
          });
          if (active === controller && !signal.aborted)
            setState({
              generationErrorCode: validatedGenerationErrorCode(body.code),
            });
          throw Error("Generation request failed.");
        }
        if (signal.aborted || active !== controller) return;
        if (!response.body) {
          streamFailure = "stream-error";
          diagnostic.terminal({
            reason: "transport-error",
            failureCode: "transport",
          });
          throw Error("The provider response did not include a stream.");
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let pending = "";
        const classifyStreamError = (record: unknown) => {
          streamFailure =
            generationStreamFailureForRecord(record) ?? streamFailure;
          const feedback = generationFeedbackForFailure(project.id, record);
          if (feedback?.finishReason)
            providerFinishReason = feedback.finishReason;
          if (
            feedback &&
            (feedback.code === "PROVIDER_STREAM_ERROR" ||
              feedback.code === "CHATGPT_GENERATION_ERROR")
          ) {
            providerTimeout = feedback.reason === "timeout";
            streamErrorRecord = true;
          } else if (feedback) parserFailure = true;
          else streamErrorRecord = true;
        };
        const consumeRecord = async (record: unknown) => {
          streamFailure =
            generationStreamFailureForRecord(record) ?? streamFailure;
          const feedback = generationFeedbackForFailure(project.id, record);
          if (feedback) failureFeedback = feedback;
          if (feedback?.finishReason)
            providerFinishReason = feedback.finishReason;
          if (
            record &&
            typeof record === "object" &&
            !Array.isArray(record) &&
            typeof (record as Record<string, unknown>).error === "string"
          )
            throw Error((record as Record<string, unknown>).error as string);
          diagnostic.phase("apply");
          try {
            return await apply(record as ModelCommand);
          } catch (error) {
            if (!journalFailure)
              applyFailure =
                applyFailure ||
                error instanceof ZodError ||
                error instanceof SyntaxError;
            throw error;
          }
        };
        while (true) {
          let next: ReadableStreamReadResult<Uint8Array>;
          try {
            next = await reader.read();
          } catch (error) {
            streamFailure = "transport-error";
            throw error;
          }
          const { done, value } = next;
          if (done) {
            streamEnded = true;
            pending += decoder.decode();
            break;
          }
          diagnostic.noteOutputBytes(value.byteLength);
          diagnostic.phase("first-byte");
          pending += decoder.decode(value, { stream: true });
          if (pending.length > 100000) {
            observationLimit = true;
            diagnostic.terminal({
              reason: "output-limit",
              failureCode: "output-limit",
            });
            throw Error("The provider sent an oversized scene update.");
          }
          const lines = pending.split("\n");
          pending = lines.pop()!;
          for (const line of lines) {
            if (!line.trim()) continue;
            let record: unknown;
            try {
              record = JSON.parse(line);
            } catch (error) {
              parserFailure = true;
              diagnostic.terminal({
                reason: "parser-failure",
                failureCode: "parser",
              });
              throw error;
            }
            if (
              record &&
              typeof record === "object" &&
              !Array.isArray(record) &&
              typeof (record as Record<string, unknown>).error === "string"
            ) {
              classifyStreamError(record);
            }
            if (!(await consumeRecord(record))) {
              await reader.cancel().catch(() => undefined);
              return;
            }
          }
        }
        if (pending.trim()) {
          let record: unknown;
          try {
            record = JSON.parse(pending);
          } catch (error) {
            parserFailure = true;
            diagnostic.terminal({
              reason: "parser-failure",
              failureCode: "parser",
            });
            throw error;
          }
          if (
            record &&
            typeof record === "object" &&
            !Array.isArray(record) &&
            typeof (record as Record<string, unknown>).error === "string"
          ) {
            classifyStreamError(record);
          }
          if (!(await consumeRecord(record))) return;
        }
        if (lastAppliedCommand !== "commit_revision") {
          streamFailure = streamFailure ?? "clean-eof-without-commit";
          diagnostic.terminal({
            reason: "clean-eof-without-commit",
            failureCode: "parser",
            finishReason: providerFinishReason,
          });
          throw Error("Generation ended before committing this turn.");
        }
      }
      if (active === controller && !signal.aborted) {
        await runAuthoringReview();
        if (!currentAt()) return;
        await finishReviewedRun(
          reviewIncomplete
            ? "Scene saved, but review could not finish."
            : reviewPartial
              ? `The correction was applied; the final review still found: ${reviewRemainingIssue}`
              : reviewEnabled
                ? reviewImageSupported
                  ? "Scene verified. Changes are applied."
                  : "Scene structure verified. Changes are applied."
                : "Generation complete. Changes are applied.",
          reviewIncomplete || reviewPartial ? "failed" : "completed",
          reviewPartial ? reviewRemainingIssue : undefined,
          reviewPartial ? reviewContinuationRevision : undefined,
        );
      }
    } catch (error) {
      const stale =
        active !== controller || getState().project.id !== project.id;
      const failureReason: GenerationStreamFailureReason | undefined =
        signal.aborted
          ? undefined
          : stale
            ? undefined
            : observationLimit
              ? "output-limit"
              : providerTimeout
                ? "deadline"
                : (streamFailure ??
                  (providerFinishReason === "length"
                    ? "output-limit"
                    : applyFailure ||
                        parserFailure ||
                        error instanceof ZodError ||
                        error instanceof SyntaxError
                      ? "parser-failure"
                      : streamEnded && lastAppliedCommand !== "commit_revision"
                        ? "clean-eof-without-commit"
                        : streamErrorRecord
                          ? "stream-error"
                          : "stream-error"));
      if (signal.aborted) {
        diagnostic.terminal({
          reason: "client-abort",
          abortSource: "client",
          failureCode: "cancelled",
          finishReason: providerFinishReason,
        });
      } else if (stale) {
        diagnostic.terminal({ reason: "stale-run", failureCode: "unknown" });
      } else {
        const reason = failureReason ?? "stream-error";
        diagnostic.terminal({
          reason,
          failureCode:
            applyFailure && !journalFailure
              ? "invalid-input"
              : generationFailureCode(reason),
          finishReason: providerFinishReason,
        });
      }
      if (active === controller && !signal.aborted) {
        finishRunExperience("error");
        publishActivity("failed", "This request could not be completed.");
        const checkpoint = baseline ?? before;
        const interruptedReviewContinuation =
          reviewStarted &&
          reviewRequestFailed &&
          authoringRunId &&
          checkpoint.revision > before.revision &&
          getState().project.id === project.id &&
          getState().project.revision === checkpoint.revision &&
          getState().saved &&
          writerCurrent() &&
          journalCurrent()
            ? {
                projectId: project.id,
                revision: checkpoint.revision,
                prompt,
                priorRunId: authoringRunId!,
                ...(selected ? { selected } : {}),
                browserModeling,
                provider: connection.provider,
                model: connection.model,
                ...(connection.effort !== undefined
                  ? { effort: connection.effort }
                  : {}),
                reviewImageSupported,
              }
            : undefined;
        const restoreUi =
          checkpoint.revision > before.revision ? getState() : preservedUiState;
        const recoverySelected =
          restoreUi.selected &&
          checkpoint.entities.some((entity) => entity.id === restoreUi.selected)
            ? restoreUi.selected
            : undefined;
        setState({
          phase:
            initial && restoreUi.phase === "landing"
              ? "editing"
              : initial && restoreUi.phase === "descending"
                ? "editing"
                : restoreUi.phase,
          building: false,
          project: checkpoint,
          selected: recoverySelected,
          playing: restoreUi.playing,
          score: restoreUi.score,
          won: restoreUi.won,
          lost: restoreUi.lost,
          gameScore: restoreUi.gameScore,
          ruleRestartCount: restoreUi.ruleRestartCount,
          reset: restoreUi.reset,
          history: restoreUi.history,
          future: restoreUi.future,
          generationRecovery: reviewStarted
            ? undefined
            : {
                projectId: project.id,
                prompt,
                ...(recoverySelected ? { selected: recoverySelected } : {}),
                checkpoint,
                ...(failureFeedback ? { feedback: failureFeedback } : {}),
              },
          interruptedReviewContinuation,
          error: reviewStarted
            ? "Scene saved, but review could not finish. Your world is safe."
            : generationFailureCopy(failureReason ?? "parser-failure"),
        });
        if (reviewStarted)
          publishActivity(
            "failed",
            "Scene saved, but review could not finish.",
            checkpoint.revision,
          );
        if (
          getState().project.entities.length > 0 ||
          getState().project.messages.length > 0
        )
          await getState().save();
      }
    } finally {
      signal.removeEventListener("abort", cancelDurable);
      signal.removeEventListener("abort", recordClientAbort);
      if (durableRun?.state === "running") cancelDurable();
      if (active === controller) {
        diagnostic.terminal({
          reason: signal.aborted ? "client-abort" : "stale-run",
          abortSource: signal.aborted ? "client" : undefined,
          failureCode: signal.aborted ? "cancelled" : "unknown",
        });
        finishRunExperience("cancelled");
        active = undefined;
        if (activeAuthoringRun?.controller === controller)
          clearActiveAuthoringRun();
        setState({ building: false });
      }
    }
  },
}));
