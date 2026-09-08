import { assetManifest, requireCatalogAsset } from "./asset-catalog";
import type { Project } from "./protocol";

/** Immutable model and license files required to play this exact revision. */
export async function bundleCatalogAssets(
  project: Project,
  read: (path: string) => Promise<Uint8Array>,
): Promise<Record<string, Uint8Array>> {
  const ids = new Set(
    project.entities.flatMap((entity) =>
      entity.geometry?.kind === "asset" ? [entity.geometry.assetId] : [],
    ),
  );
  if (!ids.size) return {};
  const assets = [...ids].map(requireCatalogAsset);
  const sources = assetManifest.sources.filter((source) =>
    assets.some((asset) => asset.sourceId === source.sourceId),
  );
  const files: Record<string, Uint8Array> = {};
  async function verified(path: string, digest: string, expectedSize?: number) {
    const bytes = await read(path);
    if (
      bytes.byteLength > 10 * 1024 * 1024 ||
      (expectedSize !== undefined && bytes.byteLength !== expectedSize)
    )
      throw Error("A model or license has an unexpected size. Export stopped.");
    const hash = new Uint8Array(
      await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)),
    );
    if (
      [...hash].map((byte) => byte.toString(16).padStart(2, "0")).join("") !==
      digest
    )
      throw Error(
        "A model or license failed its integrity check. Export stopped.",
      );
    files[path] = bytes;
  }
  for (const asset of assets)
    await verified(asset.path.slice(1), asset.sha256, asset.sizeBytes);
  for (const source of sources)
    await verified(source.license.textFile, source.license.textSha256);
  files["assets/catalog/used-assets.json"] = new TextEncoder().encode(
    JSON.stringify(
      {
        schemaVersion: assetManifest.schemaVersion,
        catalogVersion: assetManifest.catalogVersion,
        assets,
        sources,
      },
      null,
      2,
    ),
  );
  return files;
}
