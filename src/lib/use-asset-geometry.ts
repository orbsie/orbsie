"use client";

import { useEffect, useState } from "react";
import type { BufferGeometry, DataTexture } from "three";
import { AssetGeometryLoader } from "./asset-geometry";
import type { AssetId } from "./asset-catalog";
import { createAssetDataTexture } from "./asset-texture";

// Retain a bounded shared cache across scene revisions. Each scene receives
// its own clone before adding mutable formation attributes or material tint.
const loaderOptions = { maxCacheEntries: 10 } as const;
const loader = new AssetGeometryLoader(loaderOptions);
const readyAssets = new Map<AssetId, number>();
export type ReleaseAssetAppearance = () => void;

export function isAssetGeometryReady(id: AssetId) {
  return (readyAssets.get(id) ?? 0) > 0;
}

export function useAssetGeometry(assetId: AssetId | undefined) {
  const [result, setResult] = useState<{
    id: AssetId;
    geometry?: BufferGeometry;
    texture?: DataTexture;
    /** Retain the decoded lease while Formation keeps a last-good snapshot. */
    retain?: () => ReleaseAssetAppearance;
    error?: string;
  }>();
  useEffect(() => {
    if (!assetId) return;
    const controller = new AbortController();
    let owned: BufferGeometry | undefined;
    let texture: DataTexture | undefined;
    let lease: Awaited<ReturnType<AssetGeometryLoader["load"]>> | undefined;
    let leaseReleased = false;
    let retainedAppearanceCount = 0;
    let disposed = false;
    const releaseLease = () => {
      if (leaseReleased) return;
      leaseReleased = true;
      lease?.release();
    };
    const retain = (): ReleaseAssetAppearance => {
      if (!lease || leaseReleased || !texture) return () => undefined;
      retainedAppearanceCount += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        retainedAppearanceCount = Math.max(0, retainedAppearanceCount - 1);
        if (disposed && retainedAppearanceCount === 0) releaseLease();
      };
    };
    void loader.load(assetId, { signal: controller.signal }).then(
      (loaded) => {
        try {
          if (controller.signal.aborted || disposed) {
            loaded.release();
            return;
          }
          lease = loaded;
          owned = loaded.geometry.clone();
          texture = loaded.baseColorTexture
            ? createAssetDataTexture(loaded.baseColorTexture)
            : undefined;
          readyAssets.set(assetId, (readyAssets.get(assetId) ?? 0) + 1);
          setResult({
            id: assetId,
            geometry: owned,
            texture,
            ...(texture ? { retain } : {}),
          });
        } catch {
          texture?.dispose();
          texture = undefined;
          owned?.dispose();
          owned = undefined;
          releaseLease();
          lease = undefined;
          if (!controller.signal.aborted && !disposed)
            setResult({
              id: assetId,
              error: "This model could not be loaded.",
            });
        }
      },
      () => {
        if (!controller.signal.aborted && !disposed)
          setResult({ id: assetId, error: "This model could not be loaded." });
      },
    );
    return () => {
      disposed = true;
      controller.abort();
      if (retainedAppearanceCount === 0) releaseLease();
      if (owned) {
        const remaining = (readyAssets.get(assetId) ?? 1) - 1;
        if (remaining > 0) readyAssets.set(assetId, remaining);
        else readyAssets.delete(assetId);
      }
      texture?.dispose();
      owned?.dispose();
    };
  }, [assetId]);
  return result?.id === assetId ? result : undefined;
}
