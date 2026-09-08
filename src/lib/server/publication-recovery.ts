export const PUBLICATION_RECOVERY_MAX_PAGES = 5;
export const PUBLICATION_RECOVERY_LIMIT = 100;

export type RecoveryDeployment = {
  id?: string;
  uid?: string;
  url?: string;
  state?: string;
  readyState?: string;
  meta?: {
    orbId?: unknown;
    orbRevision?: unknown;
    artifactDigest?: unknown;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

export class PublicationRecoveryError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "PublicationRecoveryError";
  }
}

type DeploymentPage = {
  deployments: RecoveryDeployment[];
  next: number | null;
};

export type ListPublicationDeployments = (
  params: URLSearchParams,
  signal: AbortSignal,
) => Promise<unknown>;

function malformed(message: string): PublicationRecoveryError {
  return new PublicationRecoveryError(
    `Publication recovery search was inconclusive; no deployment was created. ${message}`,
  );
}

function aborted(signal: AbortSignal): PublicationRecoveryError {
  return new PublicationRecoveryError(
    "Publication recovery search timed out; no deployment was created.",
    { cause: signal.reason },
  );
}

function parsePage(value: unknown): DeploymentPage {
  if (!value || typeof value !== "object")
    throw malformed("Vercel returned an invalid deployment list.");
  const page = value as Record<string, unknown>;
  if (!Array.isArray(page.deployments))
    throw malformed("Vercel returned an invalid deployment list.");
  if (
    !page.pagination ||
    typeof page.pagination !== "object" ||
    !Object.prototype.hasOwnProperty.call(page.pagination, "next")
  )
    throw malformed("Vercel returned incomplete deployment pagination.");
  const next = (page.pagination as Record<string, unknown>).next;
  let cursor: number | null;
  if (next === null) cursor = null;
  else {
    const cursorValue =
      typeof next === "number"
        ? next
        : typeof next === "string" && /^[0-9]+$/.test(next)
          ? Number(next)
          : Number.NaN;
    if (!Number.isSafeInteger(cursorValue) || cursorValue <= 0)
      throw malformed("Vercel returned an invalid deployment cursor.");
    cursor = cursorValue;
  }
  const deployments = page.deployments.map((deployment) => {
    if (
      !deployment ||
      typeof deployment !== "object" ||
      Array.isArray(deployment)
    )
      throw malformed("Vercel returned an invalid deployment record.");
    return deployment as RecoveryDeployment;
  });
  return { deployments, next: cursor };
}

function matches(
  deployment: RecoveryDeployment,
  projectId: string,
  revision: number,
  artifactDigest: string,
): boolean {
  return (
    !!deployment.meta &&
    typeof deployment.meta === "object" &&
    deployment.meta.orbId === projectId &&
    deployment.meta.orbRevision === String(revision) &&
    deployment.meta.artifactDigest === artifactDigest
  );
}

/**
 * Find an accepted deployment without creating a duplicate. Every page and
 * cursor must be structurally trustworthy before a no-match result permits a
 * new deployment. Upstream HttpErrors are deliberately allowed through so
 * the route can preserve permission and rate-limit messages.
 */
export async function recoverPublicationDeployment(options: {
  orbId: string;
  vercelProjectId: string;
  revision: number;
  artifactDigest: string;
  listDeployments: ListPublicationDeployments;
  signal?: AbortSignal;
  maxPages?: number;
  isUpstreamError?: (error: unknown) => boolean;
}): Promise<RecoveryDeployment | null> {
  const maxPages = options.maxPages ?? PUBLICATION_RECOVERY_MAX_PAGES;
  if (!Number.isInteger(maxPages) || maxPages < 1)
    throw new PublicationRecoveryError(
      "Publication recovery search was inconclusive; no deployment was created.",
    );
  const controller = new AbortController();
  const signal = options.signal ?? controller.signal;
  let until: number | undefined;
  const seenCursors = new Set<number>();

  for (let pageNumber = 0; pageNumber < maxPages; pageNumber += 1) {
    if (signal.aborted) throw aborted(signal);
    const params = new URLSearchParams({
      projectId: options.vercelProjectId,
      limit: String(PUBLICATION_RECOVERY_LIMIT),
    });
    if (until !== undefined) params.set("until", String(until));
    let rawPage: unknown;
    try {
      rawPage = await options.listDeployments(params, signal);
    } catch (error) {
      if (options.isUpstreamError?.(error)) throw error;
      throw new PublicationRecoveryError(
        "Publication recovery search failed; no deployment was created.",
        { cause: error },
      );
    }
    // A provider can resolve a request after its deadline. Do not interpret
    // that stale page as an exhaustive no-match result.
    if (signal.aborted) throw aborted(signal);
    const page = parsePage(rawPage);
    for (const deployment of page.deployments) {
      if (
        !matches(
          deployment,
          options.orbId,
          options.revision,
          options.artifactDigest,
        )
      )
        continue;
      const state = deployment.readyState ?? deployment.state;
      if (state === "ERROR" || state === "CANCELED") continue;
      const identity =
        (typeof deployment.id === "string" && deployment.id.length > 0
          ? deployment.id
          : undefined) ??
        (typeof deployment.uid === "string" && deployment.uid.length > 0
          ? deployment.uid
          : undefined);
      if (
        typeof state !== "string" ||
        state.length === 0 ||
        typeof deployment.url !== "string" ||
        deployment.url.length === 0 ||
        !identity
      )
        throw malformed("Vercel returned an incomplete matching deployment.");
      return deployment;
    }
    if (page.next === null) return null;
    if (
      seenCursors.has(page.next) ||
      (until !== undefined && page.next >= until)
    )
      throw malformed("Vercel returned a non-advancing deployment cursor.");
    seenCursors.add(page.next);
    until = page.next;
  }
  throw malformed("Vercel deployment pagination exceeded the safety bound.");
}
