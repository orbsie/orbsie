import { z } from "zod";
import {
  canonicalBrowserProceduralSource,
  hashBrowserProceduralSource,
  type BrowserProceduralSource,
} from "./browser-procedural";
import { projectSchema, type ModelCommand, type Project } from "./protocol";

export const SCENE_BINDING_VERSION = 1 as const;

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const provenanceSchema = z
  .object({
    source: z.unknown(),
    collision: z.enum(["none", "platform"]),
    detail: z.enum(["coarse", "refined"]),
    tint: color.optional(),
  })
  .strict();

export type SceneProvenance = z.infer<typeof provenanceSchema> & {
  /** A persisted label is checked against source bytes before binding. */
  sourceHash?: string;
};
export type SceneProvenanceMap = Map<string, SceneProvenance>;

export type SceneBinding = {
  version: typeof SCENE_BINDING_VERSION;
  projectId: string;
  revision: number;
  digest: string;
  projection: unknown;
};

export type SceneCompletion = {
  project: Project;
  binding: SceneBinding;
  provenance: ReadonlyMap<string, SceneProvenance>;
  /** The operation signal must be checked before any authority write. */
  signal: AbortSignal;
};

export type SceneFailure = {
  project: Project;
  provenance: ReadonlyMap<string, SceneProvenance>;
  error: unknown;
  signal: AbortSignal;
};

export type AuthoringLifecycleHooks = {
  onComplete?: (completion: SceneCompletion) => void | Promise<void>;
  onFailure?: (failure: SceneFailure) => void | Promise<void>;
};

export type AuthoringLifecycleController = {
  complete(): Promise<void>;
  fail(error: unknown): Promise<void>;
  completionFailed(): boolean;
};

export type AuthoringLifecycleCurrent = {
  project: Project;
  provenance: SceneProvenanceMap;
};

/**
 * Serialize the private completion/failure handoff. The signal listener makes
 * consumer cancellation fence a completion that is still hashing or writing;
 * callbacks receive that same signal so their authority writes can do the
 * same check. Callback failures are intentionally consumed after the failure
 * state is recorded, keeping stream cleanup independent of the hook writer.
 */
export function createAuthoringLifecycle(
  hooks: AuthoringLifecycleHooks | undefined,
  signal: AbortSignal,
  current: () => AuthoringLifecycleCurrent,
): AuthoringLifecycleController {
  if (!hooks)
    return {
      complete: async () => {},
      fail: async () => {},
      completionFailed: () => false,
    };
  let state: "open" | "completing" | "completed" | "failing" | "failed" =
    "open";
  let failurePromise: Promise<void> | undefined;
  let completionPromise: Promise<void> | undefined;
  let completionFailed = false;
  let abortListener: (() => void) | undefined;

  const abortError = () =>
    signal.reason instanceof Error
      ? signal.reason
      : Error("Generation cancelled.");
  async function waitForHook<T>(work: Promise<T>): Promise<T> {
    // Always consume a late callback result after cancellation. The caller
    // must not remain blocked on a writer that ignored its AbortSignal.
    work.catch(() => {});
    if (signal.aborted) throw abortError();
    let abort!: () => void;
    const cancelled = new Promise<never>((_, reject) => {
      abort = () => reject(abortError());
      signal.addEventListener("abort", abort, { once: true });
    });
    try {
      return await Promise.race([work, cancelled]);
    } finally {
      signal.removeEventListener("abort", abort);
    }
  }

  const fail = (error: unknown): Promise<void> => {
    if (state === "completed" || state === "failed")
      return failurePromise ?? Promise.resolve();
    if (!failurePromise) {
      state = "failing";
      failurePromise = (async () => {
        try {
          const snapshot = current();
          await waitForHook(
            Promise.resolve(
              hooks?.onFailure?.({
                project: snapshot.project,
                provenance: copySceneProvenance(snapshot.provenance),
                error,
                signal,
              }),
            ),
          );
        } catch {
          // The failure hook is advisory after failure has been fenced.
        } finally {
          state = "failed";
          if (abortListener) signal.removeEventListener("abort", abortListener);
        }
      })();
    }
    return failurePromise;
  };

  const complete = async () => {
    if (state !== "open") {
      await fail(signal.reason ?? Error("Scene lifecycle is no longer open."));
      throw signal.reason ?? Error("Scene lifecycle is no longer open.");
    }
    if (signal.aborted) {
      const error = signal.reason ?? Error("Generation cancelled.");
      await fail(error);
      throw error;
    }
    if (!hooks.onComplete) {
      state = "completed";
      if (abortListener) signal.removeEventListener("abort", abortListener);
      return;
    }
    state = "completing";
    completionPromise = (async () => {
      const snapshot = current();
      const binding = await createSceneBinding(
        snapshot.project,
        snapshot.provenance,
      );
      if (signal.aborted || state !== "completing")
        throw signal.reason ?? Error("Generation cancelled.");
      await waitForHook(
        Promise.resolve(
          hooks.onComplete!({
            project: snapshot.project,
            binding,
            provenance: copySceneProvenance(snapshot.provenance),
            signal,
          }),
        ),
      );
      if (signal.aborted || state !== "completing")
        throw signal.reason ?? Error("Generation cancelled.");
      state = "completed";
      if (abortListener) signal.removeEventListener("abort", abortListener);
    })();
    try {
      await completionPromise;
    } catch (error) {
      completionFailed = true;
      if (state === "completing") state = "open";
      await fail(error);
      throw error;
    }
  };

  abortListener = () => {
    void fail(signal.reason ?? Error("Generation cancelled.")).catch(() => {
      // No abort listener may create an unhandled rejection.
    });
  };
  signal.addEventListener("abort", abortListener, { once: true });
  if (signal.aborted) abortListener();

  return { complete, fail, completionFailed: () => completionFailed };
}

type CanonicalObject = { [key: string]: unknown };

function canonicalize(value: unknown): unknown {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER)
      throw Error("Scene binding contains an unsafe number.");
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const result: CanonicalObject = Object.create(null) as CanonicalObject;
    for (const key of Object.keys(value).sort()) {
      const child = (value as Record<string, unknown>)[key];
      if (child !== undefined) result[key] = canonicalize(child);
    }
    return result;
  }
  return value;
}

function cloneProvenance(value: SceneProvenance): SceneProvenance {
  return {
    source: canonicalBrowserProceduralSource(value.source),
    collision: value.collision,
    detail: value.detail,
    ...(value.tint === undefined ? {} : { tint: value.tint }),
    ...(value.sourceHash === undefined ? {} : { sourceHash: value.sourceHash }),
  };
}

function canonicalEntity(
  entity: Project["entities"][number],
  provenance: SceneProvenance | undefined,
) {
  const geometry = entity.geometry;
  let canonicalGeometry: unknown = geometry;
  if (geometry?.kind === "generated") {
    const { model: _model, ...withoutCache } = geometry;
    const job = withoutCache.job;
    if ("backend" in job && job.backend === "browser-manifold") {
      const { authoring, ...withoutAuthoring } = job;
      canonicalGeometry = {
        ...withoutCache,
        job: withoutAuthoring,
        ...(authoring
          ? {
              proceduralSource: canonicalBrowserProceduralSource(
                authoring.source,
              ),
            }
          : {}),
      };
    } else {
      canonicalGeometry = withoutCache;
    }
  }
  if (provenance) {
    canonicalGeometry = {
      kind: "generated",
      collision: provenance.collision,
      detail: provenance.detail,
      ...(provenance.tint === undefined ? {} : { tint: provenance.tint }),
      proceduralSource: canonicalBrowserProceduralSource(provenance.source),
    };
  }
  return {
    id: entity.id,
    label: entity.label,
    position: entity.position,
    scale: entity.scale,
    ...(entity.rotation === undefined ? {} : { rotation: entity.rotation }),
    ...(entity.parentId === undefined ? {} : { parentId: entity.parentId }),
    color: entity.color,
    ...(canonicalGeometry === undefined ? {} : { geometry: canonicalGeometry }),
    ...(entity.behavior === undefined ? {} : { behavior: entity.behavior }),
    ...(entity.assetPolicy === undefined
      ? {}
      : { assetPolicy: entity.assetPolicy }),
    stage: entity.stage,
  };
}

function bindingProjection(project: Project, provenance: SceneProvenanceMap) {
  return {
    domainVersion: SCENE_BINDING_VERSION,
    version: project.version,
    id: project.id,
    title: project.title,
    seed: project.seed,
    revision: project.revision,
    entities: project.entities.map((entity) =>
      canonicalEntity(entity, provenance.get(entity.id)),
    ),
    groups: (project.groups ?? []).map((group) => ({
      id: group.id,
      label: group.label,
      position: group.position,
      ...(group.rotation === undefined ? {} : { rotation: group.rotation }),
      scale: group.scale,
      ...(group.parentId === undefined ? {} : { parentId: group.parentId }),
    })),
    environment: project.environment,
    ...(project.game === undefined ? {} : { game: project.game }),
  };
}

async function digestProjection(projection: unknown) {
  const bytes = new TextEncoder().encode(
    JSON.stringify(canonicalize(projection)),
  );
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...hash].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function assertSourceHash(source: BrowserProceduralSource, expected?: string) {
  if (expected !== undefined && !/^[a-f0-9]{64}$/.test(expected))
    throw Error("Scene binding contains an invalid procedural source hash.");
  return { source, expected };
}

/** Build the private provenance map from a validated saved project. */
export function initialSceneProvenance(project: Project): SceneProvenanceMap {
  const parsed = projectSchema.parse(project);
  const result: SceneProvenanceMap = new Map();
  for (const entity of parsed.entities) {
    const geometry = entity.geometry;
    const job = geometry?.kind === "generated" ? geometry.job : undefined;
    if (
      geometry?.kind !== "generated" ||
      !job ||
      !("backend" in job) ||
      job.backend !== "browser-manifold" ||
      !("authoring" in job) ||
      !job.authoring
    )
      continue;
    const source = canonicalBrowserProceduralSource(job.authoring.source);
    const checked = assertSourceHash(source, job.authoring.sourceHash);
    result.set(entity.id, {
      source: checked.source,
      collision: geometry.collision,
      detail: geometry.detail,
      ...(geometry.tint === undefined ? {} : { tint: geometry.tint }),
      sourceHash: checked.expected,
    });
  }
  return result;
}

/** Update server-owned procedural provenance only after a command is applied. */
export function updateSceneProvenance(
  provenance: SceneProvenanceMap,
  command: ModelCommand,
) {
  if (command.type === "remove_entity") {
    provenance.delete(command.id);
    return;
  }
  if (command.type === "set_geometry") {
    const geometry = command.geometry;
    if (
      geometry.kind === "generated" &&
      "backend" in geometry.job &&
      geometry.job.backend === "browser-procedural"
    ) {
      provenance.set(command.id, {
        source: canonicalBrowserProceduralSource(geometry.job.source),
        collision: geometry.collision,
        detail: geometry.detail,
        ...(geometry.tint === undefined ? {} : { tint: geometry.tint }),
      });
    } else provenance.delete(command.id);
    return;
  }
  if (command.type === "set_material") {
    const current = provenance.get(command.id);
    if (current)
      provenance.set(command.id, {
        ...current,
        tint: command.color,
      });
  }
}

export function copySceneProvenance(provenance: SceneProvenanceMap) {
  const result: SceneProvenanceMap = new Map();
  for (const [id, value] of provenance) result.set(id, cloneProvenance(value));
  return result;
}

/**
 * Hash the authored scene, excluding messages and generated model caches.
 * Persisted browser source hashes are verified against source bytes before
 * they can participate in the binding.
 */
export async function createSceneBinding(
  project: Project,
  sourceProvenance: SceneProvenanceMap = initialSceneProvenance(project),
): Promise<SceneBinding> {
  const parsed = projectSchema.parse(project);
  const provenance = copySceneProvenance(sourceProvenance);
  const entityIds = new Set(parsed.entities.map((entity) => entity.id));
  for (const id of provenance.keys()) {
    if (!entityIds.has(id))
      throw Error("Scene binding contains stale procedural provenance.");
  }
  const entityById = new Map(
    parsed.entities.map((entity) => [entity.id, entity]),
  );
  const persistedSourceHashes = new Map<string, string>();
  for (const [id, value] of provenance) {
    const entity = entityById.get(id)!;
    const geometry = entity.geometry;
    if (!geometry) continue;
    if (geometry.kind !== "generated")
      throw Error("Scene binding provenance does not match entity geometry.");
    const job = geometry.job;
    if (
      !("backend" in job) ||
      job.backend !== "browser-manifold" ||
      !("authoring" in job) ||
      !job.authoring
    )
      throw Error("Scene binding provenance does not match entity geometry.");
    const expectedSource = canonicalBrowserProceduralSource(
      job.authoring.source,
    );
    persistedSourceHashes.set(id, job.authoring.sourceHash);
    if (
      JSON.stringify(canonicalize(expectedSource)) !==
        JSON.stringify(canonicalize(value.source)) ||
      geometry.collision !== value.collision ||
      geometry.detail !== value.detail ||
      geometry.tint !== value.tint
    )
      throw Error("Scene binding provenance does not match entity geometry.");
  }
  for (const entity of parsed.entities) {
    const geometry = entity.geometry;
    const job = geometry?.kind === "generated" ? geometry.job : undefined;
    if (
      geometry?.kind === "generated" &&
      job &&
      "backend" in job &&
      job.backend === "browser-manifold" &&
      "authoring" in job &&
      job.authoring &&
      !provenance.has(entity.id)
    )
      throw Error("Scene binding is missing procedural provenance.");
  }
  for (const [id, value] of provenance) {
    const actual = await hashBrowserProceduralSource(value.source);
    if (value.sourceHash !== undefined && value.sourceHash !== actual)
      throw Error(
        "Scene binding rejected a mismatched procedural source hash.",
      );
    const persistedSourceHash = persistedSourceHashes.get(id);
    if (persistedSourceHash !== undefined && persistedSourceHash !== actual)
      throw Error(
        "Scene binding rejected a mismatched procedural source hash.",
      );
    value.sourceHash = actual;
  }
  const projection = canonicalize(bindingProjection(parsed, provenance));
  return {
    version: SCENE_BINDING_VERSION,
    projectId: parsed.id,
    revision: parsed.revision,
    digest: await digestProjection(projection),
    projection,
  };
}
