import { generatedGLBBounds } from "../src/lib/generated-glb";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  makePublicationManifest,
  PUBLICATION_GENERATED_MODEL_MANIFEST,
  PUBLICATION_MANIFEST_FILE,
  sha256,
  verifyPublicationArtifacts,
  type PublicationFile,
} from "../src/lib/server/publication-artifact";
import {
  blankProject,
  generatedGeometrySchema,
  type Project,
} from "../src/lib/protocol";
import type { GeneratedModelMetadata } from "../src/lib/generated-models";

const evidenceGlb = new Uint8Array(
  readFileSync("public/models/kenney/nature-kit/tree_default.glb"),
);
const evidenceHash = createHash("sha256").update(evidenceGlb).digest("hex");
const evidenceMetadata: GeneratedModelMetadata = {
  version: 1,
  sha256: evidenceHash,
  bytes: evidenceGlb.byteLength,
  source: "local-blender",
  blenderVersion: "4.0.2",
  bounds: generatedGLBBounds(evidenceGlb),
  createdAt: "2026-09-08T00:00:00Z",
};

function generatedProject(
  metadata: GeneratedModelMetadata = evidenceMetadata,
): Project {
  const project = blankProject();
  project.id = "orb";
  project.revision = 2;
  project.entities = [
    {
      id: "generated-tree",
      label: "Generated tree",
      position: [0, 0, 0],
      scale: [1, 1, 1],
      color: "#ffffff",
      stage: "ready",
      geometry: generatedGeometrySchema.parse({
        kind: "generated",
        job: {
          version: 1,
          parts: [{ id: "body", shape: "box", color: "#ffffff" }],
        },
        model: metadata,
      }),
    },
  ];
  return project;
}

function generatedFiles(
  project: Project = generatedProject(),
  model = evidenceGlb,
  metadata: GeneratedModelMetadata = evidenceMetadata,
): PublicationFile[] {
  return [
    { file: "index.html", data: "<html></html>" },
    { file: "project.json", data: JSON.stringify(project) },
    { file: "runtime.js", data: "console.log('runtime');" },
    { file: "runtime.css", data: "body{}" },
    { file: "generated-geometry-worker.js", data: "self.onmessage=()=>{}" },
    { file: "asset-geometry-worker.js", data: "self.onmessage=()=>{}" },
    {
      file: `models/generated/${metadata.sha256}.glb`,
      data: model,
    },
    {
      file: PUBLICATION_GENERATED_MODEL_MANIFEST,
      data: JSON.stringify({ version: 1, models: [metadata] }),
    },
  ];
}

function deployment(files: readonly PublicationFile[]) {
  const artifact = makePublicationManifest("orb", 2, files);
  const responses = new Map<string, Response>([
    [PUBLICATION_MANIFEST_FILE, new Response(artifact.data)],
    ...files.map(
      ({ file, data }) =>
        [
          file,
          new Response(
            typeof data === "string"
              ? data
              : new Blob([data as unknown as BlobPart]),
          ),
        ] as const,
    ),
  ]);
  return { artifact, responses };
}

function installFetch(responses: Map<string, Response>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: URL | RequestInfo) => {
      const path = new URL(String(input)).pathname.slice(1);
      return responses.get(path) ?? new Response("missing", { status: 404 });
    }),
  );
}

async function verify(deploymentValue: ReturnType<typeof deployment>) {
  return verifyPublicationArtifacts({
    deploymentUrl: "https://orb.vercel.app",
    projectId: "orb",
    revision: 2,
    expectedDigest: deploymentValue.artifact.digest,
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("generated publication artifacts", () => {
  it("accepts a real checked-in GLB with coherent project and bundle metadata", async () => {
    const value = deployment(generatedFiles());
    installFetch(value.responses);
    await expect(verify(value)).resolves.toBeUndefined();
  });

  it("requires the geometry worker in new publication manifests", () => {
    expect(() =>
      makePublicationManifest(
        "orb",
        2,
        generatedFiles().filter(
          (file) => file.file !== "generated-geometry-worker.js",
        ),
      ),
    ).toThrow(/missing.*geometry worker/);
  });

  it("requires the catalog worker in new manifests and verifies its bytes", async () => {
    expect(() =>
      makePublicationManifest(
        "orb",
        2,
        generatedFiles().filter(
          (file) => file.file !== "asset-geometry-worker.js",
        ),
      ),
    ).toThrow(/missing.*catalog geometry worker/);
    const value = deployment(generatedFiles());
    expect(value.artifact.manifest.version).toBe(4);
    value.responses.set("asset-geometry-worker.js", new Response("tampered"));
    installFetch(value.responses);
    await expect(verify(value)).rejects.toThrow();
  });

  it("still verifies version 3 publications without a catalog worker", async () => {
    const value = deployment(generatedFiles());
    const manifest = {
      ...value.artifact.manifest,
      version: 3,
      files: value.artifact.manifest.files.filter(
        (file) => file.file !== "asset-geometry-worker.js",
      ),
    };
    const data = JSON.stringify(manifest);
    value.responses.set(PUBLICATION_MANIFEST_FILE, new Response(data));
    value.responses.delete("asset-geometry-worker.js");
    installFetch(value.responses);
    await expect(
      verifyPublicationArtifacts({
        deploymentUrl: "https://orb.vercel.app",
        projectId: "orb",
        revision: 2,
        expectedDigest: sha256(data),
      }),
    ).resolves.toBeUndefined();
  });

  it("rejects incomplete generated projects before creating a manifest", () => {
    const project = generatedProject();
    const entity = project.entities[0];
    if (entity.geometry?.kind !== "generated") throw Error("fixture");
    delete entity.geometry.model;
    expect(() =>
      makePublicationManifest("orb", 2, generatedFiles(project)),
    ).toThrow(/unfinished generated model/);
  });

  it("rejects missing generated files and unknown or unreferenced hashes", async () => {
    const value = deployment(generatedFiles());
    value.responses.delete(`models/generated/${evidenceHash}.glb`);
    installFetch(value.responses);
    await expect(verify(value)).rejects.toThrow(/did not serve/);

    const unknownHash = "b".repeat(64);
    expect(() =>
      makePublicationManifest("orb", 2, [
        ...generatedFiles(),
        { file: `models/generated/${unknownHash}.glb`, data: evidenceGlb },
      ]),
    ).toThrow(/not referenced by the project|model set/);
  });

  it("runs full GLB validation before accepting a tampered generated payload", async () => {
    const invalidGlb = new Uint8Array([0, 1, 2, 3]);
    const metadata: GeneratedModelMetadata = {
      ...evidenceMetadata,
      sha256: sha256(invalidGlb),
      bytes: invalidGlb.byteLength,
    };
    const files = generatedFiles(
      generatedProject(metadata),
      invalidGlb,
      metadata,
    );
    const manifest = {
      version: 2,
      projectId: "orb",
      revision: 2,
      files: files.map(({ file, data }) => ({
        file,
        bytes:
          typeof data === "string" ? Buffer.byteLength(data) : data.byteLength,
        sha256: sha256(data),
      })),
    };
    const responses = new Map<string, Response>([
      [PUBLICATION_MANIFEST_FILE, new Response(JSON.stringify(manifest))],
      ...files.map(
        ({ file, data }) =>
          [
            file,
            new Response(
              typeof data === "string"
                ? data
                : new Blob([data as unknown as BlobPart]),
            ),
          ] as const,
      ),
    ]);
    installFetch(responses);
    await expect(
      verifyPublicationArtifacts({
        deploymentUrl: "https://orb.vercel.app",
        projectId: "orb",
        revision: 2,
        expectedDigest: sha256(JSON.stringify(manifest)),
      }),
    ).rejects.toThrow(/failed GLB validation/);
  });

  it("continues to accept historical four-file version-one manifests", async () => {
    const files: PublicationFile[] = [
      { file: "index.html", data: "<html></html>" },
      {
        file: "project.json",
        data: JSON.stringify({ id: "orb", revision: 2, title: "Legacy" }),
      },
      { file: "runtime.js", data: "console.log('legacy');" },
      { file: "runtime.css", data: "body{}" },
      { file: "generated-geometry-worker.js", data: "self.onmessage=()=>{}" },
      { file: "asset-geometry-worker.js", data: "self.onmessage=()=>{}" },
    ];
    const modern = deployment(files);
    const legacyManifest = JSON.stringify({
      ...modern.artifact.manifest,
      files: modern.artifact.manifest.files.slice(0, 4),
      version: 1,
    });
    modern.responses.set(
      PUBLICATION_MANIFEST_FILE,
      new Response(legacyManifest),
    );
    modern.artifact.digest = sha256(legacyManifest);
    installFetch(modern.responses);
    await expect(verify(modern)).resolves.toBeUndefined();
  });
});
