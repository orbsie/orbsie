import { expect, it } from "vitest";
import {
  BROWSER_PROCEDURAL_SOURCE_MAX_BYTES,
  hashBrowserProceduralSource,
  type BrowserProceduralSource,
} from "../src/lib/browser-procedural";
import { blankProject, type Project } from "../src/lib/protocol";
import { assertBrowserProceduralIntegrity } from "../src/lib/server/browser-procedural-integrity";

const source: BrowserProceduralSource = {
  version: 1,
  language: "quickjs",
  seed: 9,
  code: `({version:1,revision:0,output:"box",nodes:[{id:"box",kind:"box",size:[2,2,2]}]})`,
};
const recipe = {
  version: 1 as const,
  revision: 0,
  output: "box",
  nodes: [
    {
      id: "box",
      kind: "box" as const,
      size: [2, 2, 2] as [number, number, number],
    },
  ],
};

function projectWithAuthoring(
  sourceValue: BrowserProceduralSource,
  sourceHash: string,
): Project {
  return {
    ...blankProject(),
    entities: [
      {
        id: "shape",
        label: "Shape",
        position: [0, 0, 0],
        scale: [1, 1, 1],
        color: "#6ead60",
        stage: "ready",
        geometry: {
          kind: "generated",
          collision: "none",
          detail: "refined",
          job: {
            backend: "browser-manifold",
            recipe,
            authoring: { source: sourceValue, sourceHash },
          },
        },
      },
    ],
  } as Project;
}

it("accepts the host hash and computes each identical source once", async () => {
  const hash = await hashBrowserProceduralSource(source);
  const project = projectWithAuthoring(source, hash);
  project.entities.push({ ...project.entities[0], id: "shape-copy" });
  expect(() => assertBrowserProceduralIntegrity(project)).not.toThrow();
});

it("rejects a wrong hash without comparing source and recipe content", () => {
  expect(() =>
    assertBrowserProceduralIntegrity(
      projectWithAuthoring(source, "a".repeat(64)),
    ),
  ).toThrowError(expect.objectContaining({ status: 400 }));
});

it("rejects oversized source before any authoritative write can use it", () => {
  const oversized = {
    ...source,
    code: "é".repeat(Math.ceil(BROWSER_PROCEDURAL_SOURCE_MAX_BYTES / 2) + 1),
  };
  expect(() =>
    assertBrowserProceduralIntegrity(
      projectWithAuthoring(oversized, "a".repeat(64)),
    ),
  ).toThrowError(expect.objectContaining({ status: 400 }));
});

it("leaves ordinary projects unchanged", () => {
  expect(() => assertBrowserProceduralIntegrity(blankProject())).not.toThrow();
});
