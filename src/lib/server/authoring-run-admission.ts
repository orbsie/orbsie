import { createHmac } from "node:crypto";
import { createSceneBinding } from "../scene-binding";
import type { Project } from "../protocol";
import {
  completeInitialAuthoringRun,
  failAuthoringRun,
  issueAuthoringRun,
  type AuthoringProvider,
  type AuthoringRunBinding,
} from "./authoring-run-ledger";
import { getAuth, HttpError } from "./auth";
import { trialIdentity, type TrialIdentity } from "./trial";
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
};

export type InitialAuthoringAdmission = {
  runId: string;
  trialRemaining: number | null;
  trialCookie?: string;
  lifecycle: AuthoringLifecycleHooks;
  fail(error: unknown): Promise<void>;
};

export function authoringReviewConfigured() {
  return process.env.ORBSIE_AUTHORING_REVIEW === AUTHORING_REVIEW_FLAG;
}

function configuredSecret() {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 16)
    throw new HttpError(
      503,
      "Authoring review is temporarily unavailable. Connect your provider to continue.",
    );
  return secret;
}

function digest(domain: string, value: string) {
  return createHmac("sha256", configuredSecret())
    .update(`${domain}:${value}`)
    .digest("hex");
}

function validIdentityPart(value: unknown) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 256 &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

async function linkedIdentity(request: Request) {
  let auth: ReturnType<typeof getAuth>;
  try {
    auth = getAuth();
  } catch {
    throw new HttpError(
      503,
      "Your Orbsie session could not be checked. Retry shortly.",
    );
  }
  if (!auth) {
    const visitor = trialIdentity(request);
    return { identityHash: visitor.identityHash, trialCookie: visitor.cookie };
  }
  let session: unknown;
  try {
    session = await auth.api.getSession({ headers: request.headers });
  } catch {
    throw new HttpError(
      503,
      "Your Orbsie session could not be checked. Retry shortly.",
    );
  }
  if (!session) {
    const visitor = trialIdentity(request);
    return { identityHash: visitor.identityHash, trialCookie: visitor.cookie };
  }
  if (typeof session !== "object")
    throw new HttpError(
      503,
      "Your Orbsie session could not be checked. Retry shortly.",
    );
  const value = session as {
    user?: { id?: unknown };
    session?: { id?: unknown };
  };
  if (
    !validIdentityPart(value.user?.id) ||
    !validIdentityPart(value.session?.id)
  )
    throw new HttpError(
      503,
      "Your Orbsie session could not be checked. Retry shortly.",
    );
  const ownerId = value.user!.id as string;
  const sessionId = value.session!.id as string;
  return {
    identityHash: digest(
      "orbsie-authoring-owner-session-v1",
      JSON.stringify([ownerId, sessionId]),
    ),
  };
}

function requestFingerprint(input: InitialAuthoringAdmissionInput) {
  const normalizedPrompt = input.prompt
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ");
  return digest(
    "orbsie-authoring-request-v1",
    JSON.stringify({
      prompt: normalizedPrompt,
      projectId: input.project.id,
      provider: input.provider,
      model: input.model,
      effort: input.effort ?? null,
      selected: input.selected ?? null,
      localModeling: input.localModeling,
      browserModeling: input.browserModeling,
      authoringReview: true,
    }),
  );
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
  const linked =
    input.provider === "free"
      ? {
          identityHash: input.trialIdentity?.identityHash,
          trialCookie: input.trialIdentity?.cookie,
        }
      : await linkedIdentity(input.request);
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
    requestFingerprint: requestFingerprint(input),
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
  const lifecycle: AuthoringLifecycleHooks = {
    onComplete: async ({ binding: completedBinding, signal }) => {
      if (terminal !== "active" || signal.aborted)
        throw cancellationError(signal);
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
    },
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
    fail: initialFailure,
  };
}
