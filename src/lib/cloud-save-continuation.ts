import { committed, projectSchema, type Project } from "./protocol";
import { createSceneBinding } from "./scene-binding";

const ACKNOWLEDGEMENT_VERSION = 1;
const ACKNOWLEDGEMENT_PREFIX = "orbsie-cloud-ack:v1";
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export type CloudSaveAcknowledgement = {
  version: 1;
  accountId: string;
  projectId: string;
  revision: number;
  snapshotToken: string;
  sceneDigest: string;
  messagesDigest: string;
};

export type CloudSaveRemote = {
  id: string;
  revision: number;
  snapshotToken: string;
  snapshot: unknown;
};

export type CloudSavePreparation =
  | {
      status: "ready";
      source: CloudSavePreparationSource;
      baseline: { revision: number; snapshotToken: string };
      project: Project;
      messagesMerged: boolean;
    }
  | {
      status: "blocked";
      reason:
        | "invalid-cloud-snapshot"
        | "remote-project-mismatch"
        | "cloud-version-changed"
        | "acknowledgement-mismatch"
        | "account-mismatch"
        | "project-mismatch"
        | "local-revision-behind"
        | "local-ancestor-unproven"
        | "transcript-order-unproven";
    };

export type CloudSavePreparationSource =
  "exact-snapshot" | "same-scene" | "acknowledged-history" | "legacy-history";

export type CloudAcknowledgementStorage = Pick<Storage, "getItem" | "setItem">;

export function cloudSaveAcknowledgementKey(
  accountId: string,
  projectId: string,
) {
  return `${ACKNOWLEDGEMENT_PREFIX}:${encodeURIComponent(accountId)}:${encodeURIComponent(projectId)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function parseAcknowledgement(value: unknown): CloudSaveAcknowledgement | null {
  if (!isRecord(value)) return null;
  const expectedKeys = [
    "version",
    "accountId",
    "projectId",
    "revision",
    "snapshotToken",
    "sceneDigest",
    "messagesDigest",
  ];
  if (
    Object.keys(value).length !== expectedKeys.length ||
    expectedKeys.some((key) => !(key in value)) ||
    value.version !== ACKNOWLEDGEMENT_VERSION ||
    typeof value.accountId !== "string" ||
    value.accountId.length === 0 ||
    value.accountId.length > 255 ||
    typeof value.projectId !== "string" ||
    value.projectId.length === 0 ||
    value.projectId.length > 80 ||
    !Number.isSafeInteger(value.revision) ||
    (value.revision as number) < 0 ||
    typeof value.snapshotToken !== "string" ||
    !SHA256_PATTERN.test(value.snapshotToken) ||
    typeof value.sceneDigest !== "string" ||
    !SHA256_PATTERN.test(value.sceneDigest) ||
    typeof value.messagesDigest !== "string" ||
    !SHA256_PATTERN.test(value.messagesDigest)
  )
    return null;
  return value as CloudSaveAcknowledgement;
}

export function readCloudSaveAcknowledgement(
  storage: CloudAcknowledgementStorage,
  accountId: string,
  projectId: string,
): CloudSaveAcknowledgement | null {
  try {
    const parsed = JSON.parse(
      storage.getItem(cloudSaveAcknowledgementKey(accountId, projectId)) ??
        "null",
    );
    const acknowledgement = parseAcknowledgement(parsed);
    return acknowledgement?.accountId === accountId &&
      acknowledgement.projectId === projectId
      ? acknowledgement
      : null;
  } catch {
    return null;
  }
}

export function writeCloudSaveAcknowledgement(
  storage: CloudAcknowledgementStorage,
  acknowledgement: CloudSaveAcknowledgement,
): boolean {
  const parsed = parseAcknowledgement(acknowledgement);
  if (!parsed) return false;
  try {
    storage.setItem(
      cloudSaveAcknowledgementKey(parsed.accountId, parsed.projectId),
      JSON.stringify(parsed),
    );
    return true;
  } catch {
    return false;
  }
}

function canonicalJSON(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const serialized = JSON.stringify(value);
    if (serialized === undefined)
      throw new TypeError("Cloud save evidence contains a non-JSON value.");
    return serialized;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJSON(record[key])}`)
    .join(",")}}`;
}

async function sha256(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJSON(value));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Recompute the server's project snapshot token over its canonical JSON. */
export async function computeProjectSnapshotToken(
  snapshot: unknown,
): Promise<string> {
  return sha256(snapshot);
}

async function sceneIdentityDigest(project: Project): Promise<string> {
  const binding = await createSceneBinding(committed(project));
  const projection = binding.projection;
  if (!isRecord(projection))
    throw new TypeError("Cloud save scene identity is invalid.");
  const { revision: _revision, ...sceneProjection } = projection;
  return sha256(sceneProjection);
}

async function messagesDigest(project: Project): Promise<string> {
  return sha256(projectSchema.parse(project).messages);
}

export async function createCloudSaveAcknowledgement(
  project: Project,
  accountId: string,
  revision: number,
  snapshotToken: string,
): Promise<CloudSaveAcknowledgement> {
  const parsed = projectSchema.parse(committed(project));
  if (
    accountId.length === 0 ||
    accountId.length > 255 ||
    revision !== parsed.revision ||
    !SHA256_PATTERN.test(snapshotToken)
  )
    throw new TypeError("Cloud save acknowledgement is invalid.");
  return {
    version: 1,
    accountId,
    projectId: parsed.id,
    revision,
    snapshotToken,
    sceneDigest: await sceneIdentityDigest(parsed),
    messagesDigest: await messagesDigest(parsed),
  };
}

function sameJSON(left: unknown, right: unknown) {
  return canonicalJSON(left) === canonicalJSON(right);
}

function isMessagePrefix(
  prefix: Project["messages"],
  value: Project["messages"],
) {
  return (
    prefix.length <= value.length &&
    prefix.every((message, index) => sameJSON(message, value[index]))
  );
}

function mergeMessages(
  local: Project["messages"],
  remote: Project["messages"],
): Project["messages"] | null {
  if (isMessagePrefix(local, remote)) return remote;
  if (isMessagePrefix(remote, local)) return local;
  return null;
}

function parseRemote(value: unknown): {
  id: string;
  revision: number;
  snapshotToken: string;
  snapshot: Project;
  tokenSnapshot: unknown;
} | null {
  if (!isRecord(value)) return null;
  const parsedSnapshot = projectSchema.safeParse(value.snapshot);
  if (
    typeof value.id !== "string" ||
    !Number.isSafeInteger(value.revision) ||
    (value.revision as number) < 0 ||
    typeof value.snapshotToken !== "string" ||
    !SHA256_PATTERN.test(value.snapshotToken) ||
    !parsedSnapshot.success ||
    parsedSnapshot.data.id !== value.id ||
    parsedSnapshot.data.revision !== value.revision
  )
    return null;
  return {
    id: value.id,
    revision: value.revision as number,
    snapshotToken: value.snapshotToken,
    snapshot: parsedSnapshot.data,
    tokenSnapshot: value.snapshot,
  };
}

function exactProjectExceptRevision(left: Project, right: Project) {
  return sameJSON(
    { ...committed(left), revision: 0 },
    { ...committed(right), revision: 0 },
  );
}

function orderedPastHistory(history: readonly Project[], local: Project) {
  const result: Project[] = [];
  let previousRevision = -1;
  for (const entry of history) {
    const candidate = projectSchema.safeParse(entry);
    if (
      !candidate.success ||
      candidate.data.id !== local.id ||
      candidate.data.revision >= local.revision ||
      candidate.data.revision < previousRevision
    )
      return null;
    previousRevision = candidate.data.revision;
    result.push(candidate.data);
  }
  return result;
}

export async function prepareCloudSaveContinuation(input: {
  accountId: string;
  project: Project;
  history: readonly Project[];
  acknowledgement: unknown;
  remote: unknown;
}): Promise<CloudSavePreparation> {
  const local = projectSchema.parse(input.project);
  const remote = parseRemote(input.remote);
  if (!remote) return { status: "blocked", reason: "invalid-cloud-snapshot" };
  if (remote.id !== local.id)
    return { status: "blocked", reason: "remote-project-mismatch" };
  if (local.revision < remote.revision)
    return { status: "blocked", reason: "local-revision-behind" };
  const history = orderedPastHistory(input.history, local);
  if (!history) return { status: "blocked", reason: "local-ancestor-unproven" };
  if (
    (await computeProjectSnapshotToken(remote.tokenSnapshot)) !==
    remote.snapshotToken
  )
    return { status: "blocked", reason: "invalid-cloud-snapshot" };

  const acknowledgement = parseAcknowledgement(input.acknowledgement);
  const remoteSceneDigest = await sceneIdentityDigest(remote.snapshot);
  const remoteMessagesDigest = await messagesDigest(remote.snapshot);
  let source: CloudSavePreparationSource | undefined;
  let ancestorProven = false;

  if (input.acknowledgement !== null && input.acknowledgement !== undefined) {
    if (!acknowledgement)
      return { status: "blocked", reason: "acknowledgement-mismatch" };
    if (acknowledgement.accountId !== input.accountId)
      return { status: "blocked", reason: "account-mismatch" };
    if (acknowledgement.projectId !== local.id)
      return { status: "blocked", reason: "project-mismatch" };
    if (
      acknowledgement.revision !== remote.revision ||
      acknowledgement.snapshotToken !== remote.snapshotToken
    )
      return { status: "blocked", reason: "cloud-version-changed" };
    if (
      acknowledgement.sceneDigest !== remoteSceneDigest ||
      acknowledgement.messagesDigest !== remoteMessagesDigest
    )
      return { status: "blocked", reason: "acknowledgement-mismatch" };

    if ((await sceneIdentityDigest(local)) === acknowledgement.sceneDigest) {
      ancestorProven = true;
      source = "same-scene";
    } else {
      for (const candidate of history) {
        if (
          (await sceneIdentityDigest(candidate)) !==
            acknowledgement.sceneDigest ||
          (!isMessagePrefix(candidate.messages, remote.snapshot.messages) &&
            !isMessagePrefix(remote.snapshot.messages, candidate.messages))
        )
          continue;
        ancestorProven = true;
        source = "acknowledged-history";
        break;
      }
    }
    if (!ancestorProven)
      return { status: "blocked", reason: "local-ancestor-unproven" };
  } else if (exactProjectExceptRevision(local, remote.snapshot)) {
    ancestorProven = true;
    source = "exact-snapshot";
  } else {
    const localSceneDigest = await sceneIdentityDigest(local);
    if (localSceneDigest === remoteSceneDigest) {
      ancestorProven = true;
      source = "same-scene";
    } else {
      for (const candidate of history) {
        if (
          candidate.revision !== remote.revision ||
          (await sceneIdentityDigest(candidate)) !== remoteSceneDigest ||
          !isMessagePrefix(candidate.messages, remote.snapshot.messages)
        )
          continue;
        ancestorProven = true;
        source = "legacy-history";
        break;
      }
    }
    if (!ancestorProven)
      return { status: "blocked", reason: "local-ancestor-unproven" };
  }

  const messages = mergeMessages(local.messages, remote.snapshot.messages);
  if (!messages)
    return { status: "blocked", reason: "transcript-order-unproven" };
  const parsedMerged = projectSchema.parse({ ...local, messages });
  return {
    status: "ready",
    source: source!,
    baseline: {
      revision: remote.revision,
      snapshotToken: remote.snapshotToken,
    },
    project: parsedMerged,
    messagesMerged: !sameJSON(local.messages, messages),
  };
}
