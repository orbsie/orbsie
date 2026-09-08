import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { resolve, sep } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const manifestPath = resolve(root, "assets/catalog/manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

const fail = (message) => {
  throw new Error(`[catalog] ${message}`);
};
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const within = (candidate, parent) =>
  candidate === parent || candidate.startsWith(`${parent}${sep}`);

if (manifest.schemaVersion !== "orbsie.asset-catalog/v1")
  fail(`unsupported schema ${manifest.schemaVersion}`);
if (!Array.isArray(manifest.sources) || manifest.sources.length === 0)
  fail("no verified sources");
if (!Array.isArray(manifest.assets) || manifest.assets.length === 0)
  fail("no catalog assets");

const ids = new Set();
let totalBytes = 0;
for (const asset of manifest.assets) {
  if (ids.has(asset.id)) fail(`duplicate asset id ${asset.id}`);
  ids.add(asset.id);
  if (!asset.path?.startsWith("/models/")) fail(`unsafe public path ${asset.path}`);
  if (/^https?:/i.test(asset.path)) fail(`remote asset path ${asset.path}`);
  const path = resolve(root, "public", `.${asset.path}`);
  if (!within(path, resolve(root, "public"))) fail(`path escapes public: ${asset.path}`);
  const bytes = await readFile(path);
  const metadata = await stat(path);
  if (metadata.size !== asset.sizeBytes)
    fail(`${asset.id} size ${metadata.size} != ${asset.sizeBytes}`);
  if (sha256(bytes) !== asset.sha256) fail(`${asset.id} SHA-256 mismatch`);
  if (bytes.subarray(0, 4).toString("ascii") !== "glTF")
    fail(`${asset.id} is not a GLB file`);
  if (bytes.readUInt32LE(4) !== 2) fail(`${asset.id} is not glTF 2.0`);
  if (bytes.readUInt32LE(8) !== bytes.length)
    fail(`${asset.id} GLB length header mismatch`);

  const jsonLength = bytes.readUInt32LE(12);
  const jsonType = bytes.readUInt32LE(16);
  if (jsonType !== 0x4e4f534a) fail(`${asset.id} has no JSON GLB chunk`);
  const gltf = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString("utf8"));
  if (gltf.asset?.version !== "2.0") fail(`${asset.id} JSON is not glTF 2.0`);
  if ((gltf.images?.length ?? 0) !== (asset.gltf.textureCount ?? 0))
    fail(`${asset.id} texture metadata mismatch`);
  if ((gltf.meshes?.length ?? 0) !== asset.gltf.meshes)
    fail(`${asset.id} mesh metadata mismatch`);
  totalBytes += metadata.size;
}

for (const source of manifest.sources) {
  if (!/^https:\/\//.test(source.sourcePageUrl) || !/^https:\/\//.test(source.downloadUrl))
    fail(`${source.sourceId} must use HTTPS provenance URLs`);
  const licensePath = resolve(root, source.license.textFile);
  if (!within(licensePath, resolve(root, "assets/catalog")))
    fail(`${source.sourceId} license path escapes catalog`);
  const license = await readFile(licensePath);
  if (sha256(license) !== source.license.textSha256)
    fail(`${source.sourceId} license SHA-256 mismatch`);
  if (source.license.commercialUse !== true || source.license.redistribution !== true)
    fail(`${source.sourceId} is not marked commercially redistributable`);
}

const budget = manifest.policy?.maxCheckedInBytes;
if (Number.isFinite(budget) && totalBytes > budget)
  fail(`model bytes ${totalBytes} exceed budget ${budget}`);

console.log(
  `Catalog OK: ${manifest.assets.length} GLBs, ${totalBytes} model bytes, ${manifest.sources.length} verified source(s).`,
);
