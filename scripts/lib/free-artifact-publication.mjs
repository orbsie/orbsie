import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { strFromU8, unzipSync } from "fflate";

const PROJECT_FILE = "project.json";
const USED_ASSETS_FILE = "assets/catalog/used-assets.json";
const GENERATED_MANIFEST_FILE = "models/generated/manifest.json";

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function parseJSON(files, path, label) {
  const bytes = files[path];
  if (!bytes) throw new Error(`The artifact is missing ${label}.`);
  try {
    return JSON.parse(strFromU8(bytes));
  } catch {
    throw new Error(`The artifact ${label} is not valid JSON.`);
  }
}

function responseStatus(result) {
  if (typeof result?.status === "number") return result.status;
  if (typeof result?.response?.status === "number")
    return result.response.status;
  return 200;
}

function responseBody(result) {
  return result?.body && typeof result.body === "object" ? result.body : {};
}

function requireOK(result, label) {
  const status = responseStatus(result);
  const ok = result?.ok ?? (status >= 200 && status < 300);
  if (!ok) throw new Error(`${label} failed (HTTP ${status}).`);
  return responseBody(result);
}

function metadataEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function referencedAssetIds(project) {
  return new Set(
    (Array.isArray(project?.entities) ? project.entities : []).flatMap(
      (entity) =>
        entity?.geometry?.kind === "asset" &&
        typeof entity.geometry.assetId === "string"
          ? [entity.geometry.assetId]
          : [],
    ),
  );
}

function referencedGeneratedMetadata(project) {
  const models = new Map();
  for (const entity of Array.isArray(project?.entities)
    ? project.entities
    : []) {
    if (entity?.geometry?.kind !== "generated") continue;
    const metadata = entity.geometry.model;
    if (!metadata || typeof metadata.sha256 !== "string")
      throw new Error("The artifact contains an unfinished generated model.");
    const previous = models.get(metadata.sha256);
    if (previous && !metadataEqual(previous, metadata))
      throw new Error(
        "The artifact contains conflicting generated provenance.",
      );
    models.set(metadata.sha256, metadata);
  }
  return models;
}

function fileRecord(files, path, label) {
  const bytes = files[path];
  if (!bytes) throw new Error(`The artifact is missing ${label}.`);
  return {
    file: path,
    bytes: bytes.byteLength,
    sha256: digest(bytes),
    data: new Uint8Array(bytes),
  };
}

function validateProject(project) {
  if (!project || typeof project !== "object")
    throw new Error("The artifact project is not an object.");
  if (typeof project.id !== "string" || project.id.length === 0)
    throw new Error("The artifact project has no stable identity.");
  if (!Number.isInteger(project.revision) || project.revision < 0)
    throw new Error("The artifact project has an invalid revision.");
  if (!Array.isArray(project.entities))
    throw new Error("The artifact project has no entity list.");
}

/**
 * Read the exported project without changing its identity. The returned
 * publicationProject is a deliberate new cloud-world clone; callers must
 * record sourceProjectId -> publicationProject.id in evidence.
 */
export async function loadFreeArtifact(
  zipPath,
  { projectId = `pub-free-${randomUUID()}` } = {},
) {
  const zipBytes = new Uint8Array(await readFile(zipPath));
  const files = unzipSync(zipBytes);
  const sourceProject = parseJSON(files, PROJECT_FILE, PROJECT_FILE);
  const usedAssets = parseJSON(files, USED_ASSETS_FILE, USED_ASSETS_FILE);
  validateProject(sourceProject);
  const referencedModels = referencedGeneratedMetadata(sourceProject);
  const hasGeneratedManifest = files[GENERATED_MANIFEST_FILE] !== undefined;
  const generatedManifest = hasGeneratedManifest
    ? parseJSON(files, GENERATED_MANIFEST_FILE, GENERATED_MANIFEST_FILE)
    : null;
  if (!hasGeneratedManifest && referencedModels.size > 0)
    throw new Error(`The artifact is missing ${GENERATED_MANIFEST_FILE}.`);
  if (typeof projectId !== "string" || projectId.length === 0)
    throw new Error("A publication project identity is required.");
  if (projectId === sourceProject.id)
    throw new Error(
      "The publication clone must not reuse the artifact identity.",
    );
  if (!Array.isArray(usedAssets.assets) || !Array.isArray(usedAssets.sources))
    throw new Error("The artifact catalog provenance is incomplete.");
  if (
    hasGeneratedManifest &&
    (!generatedManifest ||
      generatedManifest.version !== 1 ||
      !Array.isArray(generatedManifest.models))
  )
    throw new Error("The artifact generated-model manifest is invalid.");

  const expectedFiles = [];
  const expectedPaths = new Set();
  const addExpected = (record) => {
    if (!expectedPaths.has(record.file)) {
      expectedPaths.add(record.file);
      expectedFiles.push(record);
    }
  };
  addExpected({
    ...fileRecord(files, USED_ASSETS_FILE, USED_ASSETS_FILE),
    kind: "catalog-provenance",
  });
  const assetsById = new Map(
    usedAssets.assets.map((asset) => [asset.id, asset]),
  );
  const sourcesById = new Map(
    usedAssets.sources.map((source) => [source.sourceId, source]),
  );
  for (const assetId of referencedAssetIds(sourceProject)) {
    const asset = assetsById.get(assetId);
    if (!asset || typeof asset.path !== "string" || !asset.path.startsWith("/"))
      throw new Error(
        `The artifact is missing catalog provenance for ${assetId}.`,
      );
    const assetFile = asset.path.slice(1);
    const assetBytes = fileRecord(files, assetFile, `catalog asset ${assetId}`);
    if (
      assetBytes.bytes !== asset.sizeBytes ||
      assetBytes.sha256 !== asset.sha256
    )
      throw new Error(
        `Catalog asset ${assetId} failed its local integrity check.`,
      );
    addExpected({ ...assetBytes, kind: "catalog-glb", assetId });
    const source = sourcesById.get(asset.sourceId);
    const licensePath = source?.license?.textFile;
    if (!source || typeof licensePath !== "string")
      throw new Error(
        `The artifact is missing license provenance for ${assetId}.`,
      );
    const license = fileRecord(files, licensePath, `license for ${assetId}`);
    if (license.sha256 !== source.license.textSha256)
      throw new Error(
        `The license for ${assetId} failed its local integrity check.`,
      );
    addExpected({ ...license, kind: "catalog-license", assetId });
  }

  const modelsByHash = new Map(
    (generatedManifest?.models ?? []).map((model) => [model.sha256, model]),
  );
  const generatedModels = [];
  for (const [hash, metadata] of referencedModels) {
    const manifestMetadata = modelsByHash.get(hash);
    if (!manifestMetadata || !metadataEqual(manifestMetadata, metadata))
      throw new Error(
        `The artifact generated provenance is incomplete for ${hash}.`,
      );
    const modelPath = `models/generated/${hash}.glb`;
    const modelFile = fileRecord(files, modelPath, `generated model ${hash}`);
    if (modelFile.bytes !== metadata.bytes || modelFile.sha256 !== hash)
      throw new Error(
        `Generated model ${hash} failed its local integrity check.`,
      );
    addExpected({ ...modelFile, kind: "generated-glb", hash });
    generatedModels.push({
      metadata: structuredClone(metadata),
      glb: modelFile.data,
    });
  }
  if (referencedModels.size > 0)
    addExpected({
      ...fileRecord(files, GENERATED_MANIFEST_FILE, GENERATED_MANIFEST_FILE),
      kind: "generated-provenance",
    });

  const publicationProject = structuredClone(sourceProject);
  publicationProject.id = projectId;
  publicationProject.revision = 0;
  publicationProject.messages = [];
  const expectedProject = structuredClone(publicationProject);
  expectedProject.revision = 1;
  expectedProject.messages = [];
  return {
    zipPath,
    sourceZipSha256: digest(zipBytes),
    sourceProject,
    sourceProjectId: sourceProject.id,
    publicationProject,
    expectedProject,
    expectedFiles,
    generatedModels,
    sourceZipBytes: zipBytes.byteLength,
  };
}

function base64(bytes) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return Buffer.from(binary, "binary").toString("base64");
}

/** Upload the ZIP's unique generated models immediately before the first save. */
export function withFreeArtifactGeneratedUploads(
  transport,
  artifact,
  onUpload,
) {
  if (!transport || typeof transport.request !== "function")
    throw new TypeError("A publication transport is required.");
  let uploaded = false;
  return {
    ...transport,
    request: async (path, init = {}, label) => {
      if (path === "/api/projects" && init.method === "PUT" && !uploaded) {
        if (typeof init.cookie !== "string" || init.cookie.length === 0)
          throw new Error(
            "Generated model upload requires the account session.",
          );
        for (const model of artifact.generatedModels) {
          const result = await transport.request(
            "/api/generated-models",
            {
              method: "PUT",
              cookie: init.cookie,
              body: JSON.stringify({
                metadata: model.metadata,
                glb: base64(model.glb),
              }),
            },
            `upload generated model ${model.metadata.sha256}`,
          );
          const body = requireOK(result, "generated model upload");
          if (
            body.metadata &&
            (!metadataEqual(body.metadata, model.metadata) ||
              body.metadata.sha256 !== model.metadata.sha256)
          )
            throw new Error(
              "Generated model upload returned conflicting provenance.",
            );
          await onUpload?.(model.metadata);
        }
        uploaded = true;
      }
      return transport.request(path, init, label);
    },
  };
}

function publicBytesResult(result, label) {
  const status = responseStatus(result);
  if (status !== 200)
    throw new Error(`${label} was not HTTP 200 (HTTP ${status}).`);
  if (!(result?.bytes instanceof Uint8Array))
    throw new Error(`${label} did not return binary bytes.`);
  return result.bytes;
}

/** Verify the exact referenced bytes and publishable snapshot on a signed-out release. */
export async function verifyFreeArtifactPublicFiles(
  transport,
  deploymentUrl,
  artifact,
) {
  if (typeof transport?.publicGetBytes !== "function")
    throw new TypeError("Artifact verification requires publicGetBytes.");
  const root = deploymentUrl.replace(/\/$/, "");
  const getBytes = async (file, label = file) =>
    publicBytesResult(
      await transport.publicGetBytes(`${root}/${file}`, label),
      label,
    );
  const manifestBytes = await getBytes(
    "publication-manifest.json",
    "publication manifest",
  );
  let manifest;
  try {
    manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
  } catch {
    throw new Error("The public publication manifest is invalid JSON.");
  }
  if (
    manifest.projectId !== artifact.expectedProject.id ||
    manifest.revision !== artifact.expectedProject.revision ||
    !Array.isArray(manifest.files)
  )
    throw new Error(
      "The public publication manifest does not match the cloned revision.",
    );
  const manifestByFile = new Map(
    manifest.files.map((entry) => [entry.file, entry]),
  );
  const checked = [];
  for (const expected of artifact.expectedFiles) {
    const entry = manifestByFile.get(expected.file);
    if (
      !entry ||
      entry.bytes !== expected.bytes ||
      entry.sha256 !== expected.sha256
    )
      throw new Error(
        `The public publication manifest mismatches ${expected.file}.`,
      );
    const bytes = await getBytes(expected.file, `public ${expected.file}`);
    if (
      bytes.byteLength !== expected.bytes ||
      digest(bytes) !== expected.sha256
    )
      throw new Error(
        `The public publication bytes failed integrity for ${expected.file}.`,
      );
    checked.push({
      file: expected.file,
      kind: expected.kind,
      bytes: bytes.byteLength,
      sha256: digest(bytes),
    });
  }
  const projectBytes = await getBytes(PROJECT_FILE, PROJECT_FILE);
  let project;
  try {
    project = JSON.parse(new TextDecoder().decode(projectBytes));
  } catch {
    throw new Error("The public project snapshot is invalid JSON.");
  }
  assert.deepEqual(
    project,
    artifact.expectedProject,
    "public project snapshot",
  );
  return {
    projectId: manifest.projectId,
    revision: manifest.revision,
    files: checked,
  };
}

export function artifactMutationPlan(artifact, { republish = false } = {}) {
  return {
    accountSignup: 1,
    generatedModelUploads: artifact.generatedModels.length,
    cloudProjectSaves: republish ? 2 : 1,
    publicationSubmissions: 1,
    inferenceCalls: 0,
    republishSubmissions: republish ? 1 : 0,
  };
}
