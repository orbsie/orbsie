"use client";

import { useEffect, useState } from "react";
import type { BufferGeometry } from "three";
import { AssetGeometryLoader } from "./asset-geometry";
import type { AssetId } from "./asset-catalog";

// Retain a bounded shared cache across scene revisions. Each scene receives
// its own clone before adding mutable formation attributes or material tint.
const loader = new AssetGeometryLoader({ maxCacheEntries: 10 });
const readyAssets = new Map<AssetId, number>();
export function isAssetGeometryReady(id: AssetId) {
  return (readyAssets.get(id) ?? 0) > 0;
}

export function useAssetGeometry(assetId: AssetId | undefined) {
  const [result, setResult] = useState<{
    id: AssetId;
    geometry?: BufferGeometry;
    error?: string;
  }>();
  useEffect(() => {
    if (!assetId) return;
    const controller = new AbortController();
    let owned: BufferGeometry | undefined;
    void loader.load(assetId, { signal: controller.signal }).then(
      (loaded) => {
        try {
          if (controller.signal.aborted) return;
          owned = loaded.geometry.clone();
          readyAssets.set(assetId, (readyAssets.get(assetId) ?? 0) + 1);
          setResult({ id: assetId, geometry: owned });
        } finally {
          loaded.release();
        }
      },
      () => {
        if (!controller.signal.aborted)
          setResult({ id: assetId, error: "This model could not be loaded." });
      },
    );
    return () => {
      controller.abort();
      if (owned) {
        const remaining = (readyAssets.get(assetId) ?? 1) - 1;
        if (remaining > 0) readyAssets.set(assetId, remaining);
        else readyAssets.delete(assetId);
      }
      owned?.dispose();
    };
  }, [assetId]);
  return result?.id === assetId ? result : undefined;
}
