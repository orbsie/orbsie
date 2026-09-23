import { createSceneBinding } from "../scene-binding";
import type { Project } from "../protocol";
import type { SceneBinding } from "../scene-binding";
import {
  admitAuthoringReview,
  completeInitialAuthoringRun,
  completeAuthoringReview,
  failAuthoringRun,
  issueAuthoringRun,
  type AuthoringReviewPhase,
  type AuthoringProvider,
  type AuthoringRunBinding,
} from "./authoring-run-ledger";
import { HttpError } from "./auth";
import {
  authoringRequestFingerprint,
  resolveAuthoringRequestIdentity,
  type AuthoringOwnerSession,
} from "./authoring-run-identity";
import type { TrialIdentity } from "./trial";
import type { AuthoringLifecycleHooks } from "../scene-binding";

const AUTHORING_REVIEW_FLAG = "1";

export type InitialAuthoringAdmissionInput = {
  request: Request;
  project: Project;
  prompt: string;
  provider: AuthoringProvider;
  model: string;
  effort?: string;
  selected?: string;
  localModeling: boolean;
  browserModeling: boolean;
  signal: AbortSignal;
  trialIdentity?: TrialIdentity;
  /** Server-derived identity for linked providers; never read from JSON. */
  ownerSession?: AuthoringOwnerSession;
};

export type AuthoritativeSceneBinding = Pick<
  SceneBinding,
  "version" | "projectId" | "revision" | "digest"
>;

export type InitialAuthoringAdmission = {
  runId: string;
  trialRemaining: number | null;
  trialCookie?: string;
  lifecycle: AuthoringLifecycleHooks;
  complete(
    binding: AuthoritativeSceneBinding,
    signal: AbortSignal,
  ): Promise<void>;
  fail(error: unknown): Promise<void>;
};

export type AuthoringReviewAdmission = {
  runId: string;
  reviewPhase: AuthoringReviewPhase;
  remainingReviewSlots: number;
  trialCookie?: string;
  complete(
    binding: AuthoritativeSceneBinding,
    accepted: boolean,
    signal: AbortSignal,
  ): Promise<void>;
  fail(error: unknown): Promise<void>;
};

export function authoringReviewConfigured() {
  return process.env.ORBSIE_AUTHORING_REVIEW === AUTHORING_REVIEW_FLAG;
}

function cancellationError(signal: AbortSignal) {
  return signal.reason instanceof Error
    ? signal.reason
    : Error("Generation cancelled.");
}

/**
 * Admit the initial authoring phase before inference. The returned hooks keep
 * all phase tokens private and bind completion to the validated scene binding
 * produced by the generation adapter.
 */
export async function admitInitialAuthoringRun(
  input: InitialAuthoringAdmissionInput,
): Promise<InitialAuthoringAdmission> {
  if (!authoringReviewConfigured())
    throw new HttpError(
      503,
      "Authoring review is temporarily unavailable. Retry shortly.",
    );
  if (input.signal.aborted) throw cancellationError(input.signal);

  const initialBinding = await createSceneBinding(input.project);
  const linked = await resolveAuthoringRequestIdentity({
    request: input.request,
    provider: input.provider,
    trialIdentity: input.trialIdentity,
    ownerSession: input.ownerSession,
  });
  const identityHash = linked.identityHash;
  if (!identityHash)
    throw new HttpError(
      503,
      "Authoring review is temporarily unavailable. Retry shortly.",
    );

  const binding: AuthoringRunBinding = {
    identityHash,
    projectId: input.project.id,
    provider: input.provider,
    model: input.model,
    ...(input.effort === undefined ? {} : { effort: input.effort }),
    requestFingerprint: authoringRequestFingerprint(input),
  };
  let issued: Awaited<ReturnType<typeof issueAuthoringRun>>;
  try {
    issued = await issueAuthoringRun({
      ...binding,
      initialRevision: input.project.revision,
      initialSceneDigest: initialBinding.digest,
      ...(input.provider === "free"
        ? { trialIdentity: input.trialIdentity }
        : {}),
    });
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(
      503,
      "Authoring review is temporarily unavailable. Retry shortly.",
    );
  }
  let terminal: "active" | "completed" | "failed" = "active";
  let failurePromise: Promise<void> | undefined;
  const initialFailure = async (error: unknown) => {
    if (terminal === "completed" || terminal === "failed")
      return failurePromise;
    terminal = "failed";
    failurePromise = failAuthoringRun({
      ...binding,
      runId: issued.runId,
      phaseToken: issued.phaseToken,
      revision: input.project.revision,
      sceneBindingDigest: initialBinding.digest,
    }).then(
      () => undefined,
      () => undefined,
    );
    return failurePromise;
  };
  const complete = async (
    completedBinding: AuthoritativeSceneBinding,
    signal: AbortSignal,
  ) => {
    if (terminal !== "active" || signal.aborted)
      throw cancellationError(signal);
    if (
      completedBinding.version !== initialBinding.version ||
      completedBinding.projectId !== input.project.id ||
      !Number.isSafeInteger(completedBinding.revision) ||
      completedBinding.revision < input.project.revision ||
      !/^[a-f0-9]{64}$/.test(completedBinding.digest)
    )
      throw Error("The completed scene binding is invalid.");
    await completeInitialAuthoringRun({
      ...binding,
      runId: issued.runId,
      phaseToken: issued.phaseToken,
      revision: completedBinding.revision,
      sceneBindingDigest: completedBinding.digest,
      signal,
    });
    if (signal.aborted || terminal !== "active")
      throw cancellationError(signal);
    terminal = "completed";
  };
  const lifecycle: AuthoringLifecycleHooks = {
    onComplete: ({ binding: completedBinding, signal }) =>
      complete(completedBinding, signal),
    onFailure: ({ error }) => initialFailure(error),
  };
  if (input.signal.aborted) {
    await initialFailure(cancellationError(input.signal));
    throw cancellationError(input.signal);
  }
  return {
    runId: issued.runId,
    trialRemaining: issued.trialRemaining,
    ...(linked.trialCookie ? { trialCookie: linked.trialCookie } : {}),
    lifecycle,
    complete,
    fail: initialFailure,
  };
}

/**
 * Reconstruct the initial server binding and atomically admit exactly one
 * review slot. The private phase token remains inside these completion hooks.
 */
export async function admitAuthoringReviewPhase(input: {
  request: Request;
  project: Project;
  prompt: string;
  provider: AuthoringProvider;
  model: string;
  effort?: string;
  selected?: string;
  localModeling: boolean;
  browserModeling: boolean;
  runId: string;
  reviewPhase: AuthoringReviewPhase;
  signal: AbortSignal;
  trialIdentity?: TrialIdentity;
  ownerSession?: AuthoringOwnerSession;
}): Promise<AuthoringReviewAdmission> {
  if (!authoringReviewConfigured())
    throw new HttpError(
      503,
      "Authoring review is temporarily unavailable. Retry shortly.",
    );
  if (input.signal.aborted) throw cancellationError(input.signal);

  let expectedBinding: AuthoritativeSceneBinding;
  try {
    expectedBinding = await createSceneBinding(input.project);
  } catch {
    throw new HttpError(400, "The reviewed scene is invalid.");
  }
  const linked = await resolveAuthoringRequestIdentity({
    request: input.request,
    provider: input.provider,
    trialIdentity: input.trialIdentity,
    ownerSession: input.ownerSession,
  });
  const binding: AuthoringRunBinding = {
    identityHash: linked.identityHash,
    projectId: input.project.id,
    provider: input.provider,
    model: input.model,
    ...(input.effort === undefined ? {} : { effort: input.effort }),
    requestFingerprint: authoringRequestFingerprint(input),
  };
  const admitted = await admitAuthoringReview({
    ...binding,
    runId: input.runId,
    reviewPhase: input.reviewPhase,
    expectedRevision: expectedBinding.revision,
    expectedSceneBindingDigest: expectedBinding.digest,
    signal: input.signal,
  });

  let terminal: "active" | "completed" | "failed" = "active";
  let failurePromise: Promise<void> | undefined;
  const fail = async (_error: unknown) => {
    if (terminal === "completed" || terminal === "failed")
      return failurePromise;
    terminal = "failed";
    failurePromise = failAuthoringRun({
      ...binding,
      runId: admitted.runId,
      phaseToken: admitted.phaseToken,
      revision: expectedBinding.revision,
      sceneBindingDigest: expectedBinding.digest,
    }).then(
      () => undefined,
      () => undefined,
    );
    return failurePromise;
  };
  const complete = async (
    completedBinding: AuthoritativeSceneBinding,
    accepted: boolean,
    signal: AbortSignal,
  ) => {
    if (terminal !== "active" || signal.aborted)
      throw cancellationError(signal);
    if (
      completedBinding.version !== expectedBinding.version ||
      completedBinding.projectId !== input.project.id ||
      !Number.isSafeInteger(completedBinding.revision) ||
      completedBinding.revision < expectedBinding.revision ||
      !/^[a-f0-9]{64}$/.test(completedBinding.digest)
    )
      throw Error("The completed scene binding is invalid.");
    await completeAuthoringReview({
      ...binding,
      runId: admitted.runId,
      phaseToken: admitted.phaseToken,
      reviewPhase: input.reviewPhase,
      revision: completedBinding.revision,
      sceneBindingDigest: completedBinding.digest,
      accepted,
      signal,
    });
    if (signal.aborted || terminal !== "active")
      throw cancellationError(signal);
    terminal = "completed";
  };
  if (input.signal.aborted) {
    await fail(cancellationError(input.signal));
    throw cancellationError(input.signal);
  }
  return {
    runId: admitted.runId,
    reviewPhase: input.reviewPhase,
    remainingReviewSlots: admitted.remainingReviewSlots,
    ...(linked.trialCookie ? { trialCookie: linked.trialCookie } : {}),
    complete,
    fail,
  };
}
