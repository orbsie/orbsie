import { createHash } from "node:crypto";
import {
  canonicalBrowserProceduralSource,
  type BrowserProceduralSource,
} from "../browser-procedural";
import type { Project } from "../protocol";
import { HttpError } from "./auth";

const INTEGRITY_ERROR =
  "Browser authoring metadata failed its integrity check.";

function sourceHash(source: BrowserProceduralSource): string {
  return createHash("sha256")
    .update(JSON.stringify(source), "utf8")
    .digest("hex");
}

/** Validate retained source metadata without executing source or comparing recipes. */
export function assertBrowserProceduralIntegrity(project: Project): void {
  const computed = new Map<string, string>();
  for (const entity of project.entities) {
    const geometry = entity.geometry;
    if (
      !geometry ||
      geometry.kind !== "generated" ||
      !("backend" in geometry.job) ||
      geometry.job.backend !== "browser-manifold" ||
      !geometry.job.authoring
    )
      continue;
    let source: BrowserProceduralSource;
    try {
      source = canonicalBrowserProceduralSource(geometry.job.authoring.source);
    } catch {
      throw new HttpError(400, INTEGRITY_ERROR);
    }
    const canonical = JSON.stringify(source);
    let expected = computed.get(canonical);
    if (!expected) {
      expected = sourceHash(source);
      computed.set(canonical, expected);
    }
    if (expected !== geometry.job.authoring.sourceHash)
      throw new HttpError(400, INTEGRITY_ERROR);
  }
}
