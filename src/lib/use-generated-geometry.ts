"use client";

import { useEffect, useState } from "react";
import type { BufferGeometry } from "three";
import {
  GeneratedGeometryLoader,
  type GeneratedBytesResolver,
} from "./generated-geometry";

// Retain a bounded shared cache across scene revisions. Each scene receives
// its own clone before adding mutable formation attributes or material tint.
const loaderOptions = { maxCacheEntries: 10 } as const;
let loader = new GeneratedGeometryLoader(loaderOptions);
let started = false;
const readyGenerated = new Map<string, number>();

/** Configure a trusted standalone hash resolver before any hook load starts. */
export function configureGeneratedGeometryResolver(
  resolver: GeneratedBytesResolver,
): void {
  if (started)
    throw new Error(
      "The generated geometry resolver must be configured before loading models.",
    );
  loader.dispose();
  loader = new GeneratedGeometryLoader({
    ...loaderOptions,
    resolveBytes: resolver,
  });
}

export function isGeneratedGeometryReady(hash: string): boolean {
  return (readyGenerated.get(hash) ?? 0) > 0;
}

export function useGeneratedGeometry(hash: string | undefined) {
  const [result, setResult] = useState<{
    id: string;
    geometry?: BufferGeometry;
    error?: string;
  }>();
  useEffect(() => {
    if (!hash) return;
    const controller = new AbortController();
    let owned: BufferGeometry | undefined;
    started = true;
    void loader.load(hash, { signal: controller.signal }).then(
      (loaded) => {
        try {
          if (controller.signal.aborted) return;
          owned = loaded.geometry.clone();
          readyGenerated.set(hash, (readyGenerated.get(hash) ?? 0) + 1);
          setResult({ id: hash, geometry: owned });
        } finally {
          loaded.release();
        }
      },
      () => {
        if (!controller.signal.aborted)
          setResult({ id: hash, error: "This model could not be loaded." });
      },
    );
    return () => {
      controller.abort();
      if (owned) {
        const remaining = (readyGenerated.get(hash) ?? 1) - 1;
        if (remaining > 0) readyGenerated.set(hash, remaining);
        else readyGenerated.delete(hash);
      }
      owned?.dispose();
    };
  }, [hash]);
  return result?.id === hash ? result : undefined;
}
