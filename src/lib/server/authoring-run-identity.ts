import { createHmac } from "node:crypto";
import type { Project } from "../protocol";
import { getAuth, HttpError } from "./auth";
import { trialIdentity, type TrialIdentity } from "./trial";
import type { AuthoringProvider } from "./authoring-run-ledger";

export type AuthoringOwnerSession = {
  ownerId: string;
  sessionId: string;
};

export type AuthoringRequestIdentity = {
  identityHash: string;
  trialCookie?: string;
  trialIdentity?: TrialIdentity;
};

export type AuthoringRequestFingerprintInput = {
  prompt: string;
  projectId: string;
  provider: AuthoringProvider;
  model: string;
  effort?: string;
  selected?: string;
  localModeling: boolean;
  browserModeling: boolean;
};

function configuredSecret() {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 16)
    throw new HttpError(
      503,
      "Authoring review is temporarily unavailable. Retry shortly.",
    );
  return secret;
}

function digest(domain: string, value: string) {
  return createHmac("sha256", configuredSecret())
    .update(`${domain}:${value}`)
    .digest("hex");
}

function validIdentityPart(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 256 &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

function ownerIdentity(ownerSession: AuthoringOwnerSession) {
  if (
    !validIdentityPart(ownerSession.ownerId) ||
    !validIdentityPart(ownerSession.sessionId)
  )
    throw new HttpError(
      503,
      "Your Orbsie session could not be checked. Retry shortly.",
    );
  return digest(
    "orbsie-authoring-owner-session-v1",
    JSON.stringify([ownerSession.ownerId, ownerSession.sessionId]),
  );
}

/**
 * Resolve the server-owned identity used by both initial and review phases.
 * The caller may pass an already-created trial identity for free or a
 * separately authenticated owner/session for hosted work; neither value is
 * accepted from a request body.
 */
export async function resolveAuthoringRequestIdentity(input: {
  request: Request;
  provider: AuthoringProvider;
  trialIdentity?: TrialIdentity;
  ownerSession?: AuthoringOwnerSession;
}): Promise<AuthoringRequestIdentity> {
  if (input.provider === "free") {
    const identityHash = input.trialIdentity?.identityHash;
    if (!identityHash)
      throw new HttpError(
        503,
        "Authoring review is temporarily unavailable. Retry shortly.",
      );
    return {
      identityHash,
      ...(input.trialIdentity?.cookie
        ? { trialCookie: input.trialIdentity.cookie }
        : {}),
      ...(input.trialIdentity ? { trialIdentity: input.trialIdentity } : {}),
    };
  }

  if (input.ownerSession)
    return { identityHash: ownerIdentity(input.ownerSession) };

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
    const visitor = trialIdentity(input.request);
    return {
      identityHash: visitor.identityHash!,
      trialCookie: visitor.cookie,
      trialIdentity: visitor,
    };
  }

  let session: unknown;
  try {
    session = await auth.api.getSession({ headers: input.request.headers });
  } catch {
    throw new HttpError(
      503,
      "Your Orbsie session could not be checked. Retry shortly.",
    );
  }
  if (!session) {
    const visitor = trialIdentity(input.request);
    return {
      identityHash: visitor.identityHash!,
      trialCookie: visitor.cookie,
      trialIdentity: visitor,
    };
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
  return {
    identityHash: ownerIdentity({
      ownerId: value.user.id,
      sessionId: value.session.id,
    }),
  };
}

export function authoringRequestFingerprint(
  input:
    | AuthoringRequestFingerprintInput
    | (Omit<AuthoringRequestFingerprintInput, "projectId"> & {
        project: Project;
      }),
) {
  const projectId = "project" in input ? input.project.id : input.projectId;
  const normalizedPrompt = input.prompt
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ");
  return digest(
    "orbsie-authoring-request-v1",
    JSON.stringify({
      prompt: normalizedPrompt,
      projectId,
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
