import rawManifest from "../../assets/catalog/manifest.json";

/**
 * The catalog is intentionally a local, checked-in manifest.  Keep this
 * module free of filesystem and network APIs so it can be used by both the
 * editor and a standalone player.
 */
export type AssetSelectionMode = "catalog" | "generated" | "mixed";
export type AssetRequestPolicy = "catalog-allowed" | "new-only";

export interface CatalogAsset {
  readonly id: string;
  readonly label: string;
  readonly sourceId: string;
  readonly format: "glb";
  readonly path: string;
  readonly tags: readonly string[];
  readonly archiveEntry?: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly gltf: {
    readonly version: string;
    readonly meshes: number;
    readonly nodes: number;
    readonly primitives: number;
    readonly triangles: number;
    readonly vertices: number;
    readonly materials: readonly string[];
    readonly textureCount: number;
    readonly embeddedTextures: boolean;
    readonly animationCount: number;
  };
  readonly bounds: {
    readonly min: readonly number[];
    readonly max: readonly number[];
    readonly size: readonly number[];
    readonly origin: string;
  };
  readonly scale: {
    readonly axis: string;
    readonly units: string;
    readonly sourceToRuntime: number;
    readonly normalization: string;
  };
  readonly collision: {
    readonly recommended: string;
    readonly source: string;
    readonly embedded: boolean;
  };
}

export interface CatalogSource {
  readonly sourceId: string;
  readonly title: string;
  readonly publisher: string;
  readonly authorAttribution: string;
  readonly sourcePageUrl: string;
  readonly downloadUrl: string;
  readonly license: {
    readonly spdx: string;
    readonly name: string;
    readonly url: string;
    readonly textFile: string;
    readonly textSha256: string;
    readonly commercialUse: boolean;
    readonly redistribution: boolean;
    readonly attributionRequired: boolean;
    readonly attributionRecommended: boolean;
  };
  readonly version: string;
  readonly downloadedAt: string;
  readonly archive: {
    readonly fileName: string;
    readonly sha256: string;
    readonly sizeBytes: number;
    readonly storedInRepository: boolean;
    readonly entryRoot: string;
  };
  readonly notes: string;
}

export interface AssetCatalogManifest {
  readonly schemaVersion: "orbsie.asset-catalog/v1";
  readonly catalogId: string;
  readonly catalogVersion: string;
  readonly generatedAt: string;
  readonly policy: {
    readonly allowCatalogAssets: boolean;
    readonly allowGeneratedAssets: boolean;
    readonly explicitNewOverridesCatalog: boolean;
    readonly rejectUnknownAssetIds: boolean;
    readonly rejectRemoteAssetUrls: boolean;
    readonly maxCheckedInBytes: number;
    readonly selectionModeValues: readonly AssetSelectionMode[];
    readonly requestAssetPolicyValues: readonly AssetRequestPolicy[];
  };
  readonly sources: readonly CatalogSource[];
  readonly assets: readonly CatalogAsset[];
}

const manifest = rawManifest as unknown as AssetCatalogManifest;

/**
 * The literal tuple keeps model/tool payloads type-safe.  The runtime check
 * below makes this list fail closed if the manifest changes without updating
 * the generated API contract.
 */
export const catalogAssetIds = [
  "kenney.nature.tree-default",
  "kenney.nature.tree-pine-tall-a",
  "kenney.nature.mushroom-red",
  "kenney.nature.bush-detailed",
  "kenney.nature.rock-large-a",
  "kenney.nature.bridge-wood",
  "kenney.nature.platform-grass",
  "kenney.nature.fence-gate",
  "kenney.nature.campfire-stones",
  "kenney.nature.canoe",
] as const;

export type AssetId = (typeof catalogAssetIds)[number];

function fail(message: string): never {
  throw new Error(`[asset-catalog] ${message}`);
}

function assertManifest(): void {
  if (manifest.schemaVersion !== "orbsie.asset-catalog/v1")
    fail(`unsupported manifest schema ${manifest.schemaVersion}`);
  if (!manifest.policy.allowCatalogAssets)
    fail("catalog assets are disabled by the manifest policy");
  if (!manifest.policy.rejectUnknownAssetIds)
    fail("unknown asset IDs must be rejected");
  if (!manifest.policy.rejectRemoteAssetUrls)
    fail("remote asset URLs must be rejected");

  const ids = new Set<string>();
  for (const asset of manifest.assets) {
    if (ids.has(asset.id)) fail(`duplicate asset ID ${asset.id}`);
    ids.add(asset.id);
    assertLocalAssetPath(asset.path);
    if (asset.format !== "glb") fail(`${asset.id} is not a GLB asset`);
    if (!Number.isSafeInteger(asset.sizeBytes) || asset.sizeBytes <= 0)
      fail(`${asset.id} has an invalid size bound`);
  }
  if (manifest.assets.length !== catalogAssetIds.length)
    fail("typed asset IDs do not match the catalog manifest");
  for (const id of catalogAssetIds)
    if (!ids.has(id)) fail(`typed asset ID ${id} is absent from the manifest`);
}

/** A manifest path is a local public path, never a caller-provided URL. */
export function assertLocalAssetPath(
  value: string,
): asserts value is `/${string}` {
  if (
    !value.startsWith("/models/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    value.includes("..") ||
    /[?#]/.test(value) ||
    /^[a-z][a-z\d+.-]*:/i.test(value)
  )
    fail(`unsafe asset path ${JSON.stringify(value)}`);
}

assertManifest();

export const assetManifest = manifest;
export const catalogAssets: readonly CatalogAsset[] = Object.freeze(
  manifest.assets.slice(),
);
const assetsById = new Map<string, CatalogAsset>(
  catalogAssets.map((asset) => [asset.id, asset]),
);

export function isAssetId(value: unknown): value is AssetId {
  return typeof value === "string" && assetsById.has(value);
}

/** Return undefined for untrusted model/provider input. */
export function findCatalogAsset(value: unknown): CatalogAsset | undefined {
  return typeof value === "string" ? assetsById.get(value) : undefined;
}

/** Validate a model reference at the protocol boundary. */
export function requireCatalogAsset(value: unknown): CatalogAsset {
  const asset = findCatalogAsset(value);
  if (!asset) fail(`unknown catalog asset ID ${JSON.stringify(value)}`);
  return asset;
}

/** Resolve an ID to its checked-in path; arbitrary URLs cannot enter here. */
export function assetPathFor(value: unknown): string {
  return requireCatalogAsset(value).path;
}

/**
 * Build a same-origin public URL for an asset.  The default relative path is
 * preferable in the browser and works for a Vercel deployment and exports.
 * A base URL is accepted only for a same-origin application origin; callers
 * cannot turn a catalog ID into an arbitrary remote URL.
 */
export function assetUrlFor(value: unknown, baseUrl?: string | URL): string {
  const path = assetPathFor(value);
  if (baseUrl === undefined) return path;
  const base = typeof baseUrl === "string" ? new URL(baseUrl) : baseUrl;
  if (base.protocol !== "http:" && base.protocol !== "https:")
    fail(`unsupported asset base URL protocol ${base.protocol}`);
  const url = new URL(path, base);
  if (
    url.origin !== base.origin ||
    url.pathname !== path ||
    url.search ||
    url.hash
  )
    fail(`asset URL escaped its local origin for ${path}`);
  return url.toString();
}

/**
 * A filesystem-friendly path under a known public root.  This intentionally
 * returns a normalized relative join and does not touch the filesystem, so it
 * remains safe to import in the browser.
 */
export function assetFilePathFor(
  value: unknown,
  publicRoot = "public",
): string {
  const path = assetPathFor(value).slice(1);
  const root = publicRoot.replace(/[\\/]+$/, "");
  if (!root || root === "." || root === ".." || root.includes("\0"))
    fail("invalid public asset root");
  return `${root}/${path}`;
}

export interface AssetPromptMetadata {
  readonly id: AssetId;
  readonly label: string;
  readonly keywords: readonly string[];
  readonly summary: string;
  readonly useFor: readonly string[];
  readonly collision: string;
}

const promptSummaries: Record<AssetId, string> = {
  "kenney.nature.tree-default": "A leafy stylized tree with a grounded base.",
  "kenney.nature.tree-pine-tall-a":
    "A tall dark pine for wooded or alpine scenes.",
  "kenney.nature.mushroom-red": "A small red mushroom prop for organic scenes.",
  "kenney.nature.bush-detailed":
    "A low rounded bush that works as ground cover.",
  "kenney.nature.rock-large-a": "A low rocky outcrop with a grassy top.",
  "kenney.nature.bridge-wood": "A compact wooden bridge or crossing.",
  "kenney.nature.platform-grass": "A thin grassy platform suited to traversal.",
  "kenney.nature.fence-gate":
    "A wooden fence gate for boundaries and entrances.",
  "kenney.nature.campfire-stones":
    "A small ring of stones for a campfire landmark.",
  "kenney.nature.canoe":
    "A small wooden canoe for a pond, river, or shoreline.",
};

export const assetPromptCatalog: readonly AssetPromptMetadata[] = Object.freeze(
  catalogAssetIds.map((id) => {
    const asset = requireCatalogAsset(id);
    return Object.freeze({
      id,
      label: asset.label,
      keywords: Object.freeze([...asset.tags]),
      summary: promptSummaries[id],
      useFor: Object.freeze(asset.tags.filter((tag) => tag !== "nature")),
      collision: asset.collision.recommended,
    });
  }),
);

export function promptMetadataFor(value: unknown): AssetPromptMetadata {
  const asset = requireCatalogAsset(value);
  return assetPromptCatalog.find((entry) => entry.id === asset.id)!;
}

export function promptCatalogForPolicy(
  policy: AssetRequestPolicy = "catalog-allowed",
): readonly AssetPromptMetadata[] {
  return policy === "new-only" ? [] : assetPromptCatalog;
}
