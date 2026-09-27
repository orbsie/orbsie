import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { unzipSync, zipSync } from "fflate";
import {
  artifactMutationPlan,
  loadFreeArtifact,
  verifyFreeArtifactPublicFiles,
  withFreeArtifactGeneratedUploads,
} from "../scripts/lib/free-artifact-publication.mjs";
import { prepareFreeArtifactPublication } from "../scripts/verify-free-artifact-publication.mjs";

const ZIP = "docs/evidence/provider-e2e/free-strawberry-current/free/world.zip";
const FLAGSHIP_ZIP =
  "docs/evidence/provider-e2e/openrouter-flagship-set-label-live-20260925/openrouter/world.zip";

function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

it("loads the mixed export and makes an explicit new publication clone", async () => {
  const artifact = await loadFreeArtifact(ZIP, {
    projectId: "pub-free-fixture-clone",
  });

  expect(artifact.sourceProjectId).toBe("94c7f11d-cf1a-4942-b5aa-58e318b8ecad");
  expect(artifact.publicationProject.id).toBe("pub-free-fixture-clone");
  expect(artifact.publicationProject.id).not.toBe(artifact.sourceProjectId);
  expect(artifact.sourceProject.revision).toBe(13);
  expect(artifact.expectedProject.revision).toBe(1);
  expect(artifact.generatedModels).toHaveLength(1);
  expect(
    artifact.expectedFiles.find(
      ({ file }) => file === "assets/catalog/used-assets.json",
    )?.kind,
  ).toBe("catalog-provenance");
  expect(artifact.expectedFiles.map(({ file }) => file)).toEqual(
    expect.arrayContaining([
      "assets/catalog/used-assets.json",
      "models/kenney/nature-kit/tree_default.glb",
      "assets/catalog/licenses/kenney-nature-kit-License.txt",
      "models/generated/manifest.json",
      "models/generated/7abe4b5566b68d29624d21119b2792821b874017248df80eaf9f02fb98fa68c2.glb",
    ]),
  );
  expect(artifactMutationPlan(artifact)).toEqual({
    accountSignup: 1,
    generatedModelUploads: 1,
    cloudProjectSaves: 1,
    publicationSubmissions: 1,
    inferenceCalls: 0,
    republishSubmissions: 0,
  });
});

it("loads the pinned flagship export without a generated manifest when no generated model is referenced", async () => {
  const artifact = await loadFreeArtifact(FLAGSHIP_ZIP, {
    projectId: "pub-free-flagship-clone",
  });

  expect(artifact.sourceZipSha256).toBe(
    "7630cb95236386713f84c5fc40559273e37fec18b204ea242c6c8ba8f595978a",
  );
  expect(artifact.sourceProject.revision).toBe(42);
  expect(artifact.sourceProject.entities).toHaveLength(14);
  expect(artifact.generatedModels).toHaveLength(0);
  expect(artifact.expectedFiles.map(({ file }) => file)).not.toContain(
    "models/generated/manifest.json",
  );
  expect(artifactMutationPlan(artifact)).toMatchObject({
    generatedModelUploads: 0,
    inferenceCalls: 0,
  });
});

it("still requires the generated manifest when the project references generated models", async () => {
  const files = unzipSync(new Uint8Array(await readFile(ZIP)));
  delete files["models/generated/manifest.json"];
  const tempDir = await mkdtemp(join(tmpdir(), "orbsie-publication-artifact-"));
  const zipPath = join(tempDir, "world.zip");
  try {
    await writeFile(zipPath, zipSync(files));
    await expect(
      loadFreeArtifact(zipPath, { projectId: "pub-free-missing-manifest" }),
    ).rejects.toThrow("missing models/generated/manifest.json");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

it("rejects an invalid republish material before any live publication call", async () => {
  const options = { artifactPath: FLAGSHIP_ZIP, republish: true };
  await expect(
    prepareFreeArtifactPublication({
      ...options,
      materialMutation: { entityId: "missing-entity", color: "#ff8f6b" },
    }),
  ).rejects.toThrow("missing republish target missing-entity");
  await expect(
    prepareFreeArtifactPublication({
      ...options,
      materialMutation: { entityId: "crystal-1", color: "#56eaff" },
    }),
  ).rejects.toThrow("republish material must change");
});

it("uploads each unique generated model before the cloud project save", async () => {
  const artifact = await loadFreeArtifact(ZIP, {
    projectId: "pub-free-upload-order",
  });
  const events: string[] = [];
  const requests: Array<{ path: string; init: Record<string, unknown> }> = [];
  const baseTransport = {
    request: async (path: string, init: Record<string, unknown>) => {
      requests.push({ path, init });
      events.push(path);
      if (path === "/api/generated-models")
        return {
          status: 200,
          ok: true,
          body: { metadata: artifact.generatedModels[0].metadata },
        };
      return { status: 200, ok: true, body: { revision: 1 } };
    },
  };
  const transport = withFreeArtifactGeneratedUploads(baseTransport, artifact);
  await transport.request(
    "/api/projects",
    { method: "PUT", cookie: "orbsie_session=fixture" },
    "cloud save",
  );

  expect(events).toEqual(["/api/generated-models", "/api/projects"]);
  expect(requests[0].init.cookie).toBe("orbsie_session=fixture");
  expect(JSON.parse(String(requests[0].init.body))).toMatchObject({
    metadata: artifact.generatedModels[0].metadata,
    glb: expect.any(String),
  });
  expect(
    Buffer.from(
      String(JSON.parse(String(requests[0].init.body)).glb),
      "base64",
    ),
  ).toEqual(Buffer.from(artifact.generatedModels[0].glb));
});

it("verifies public mixed-artifact bytes and the cloned publishable snapshot", async () => {
  const artifact = await loadFreeArtifact(ZIP, {
    projectId: "pub-free-public-fixture",
  });
  const projectBytes = new TextEncoder().encode(
    JSON.stringify(artifact.expectedProject),
  );
  const expected = new Map(
    artifact.expectedFiles.map((file) => [file.file, file.data]),
  );
  expected.set("project.json", projectBytes);
  const manifest = {
    version: 4,
    projectId: artifact.expectedProject.id,
    revision: artifact.expectedProject.revision,
    files: [
      {
        file: "project.json",
        bytes: projectBytes.byteLength,
        sha256: sha256(projectBytes),
      },
      ...artifact.expectedFiles.map(({ file, bytes, sha256: hash }) => ({
        file,
        bytes,
        sha256: hash,
      })),
    ],
  };
  const transport = {
    publicGetBytes: async (url: string) => {
      const file =
        new URL(url).pathname.split("/").pop() === "publication-manifest.json"
          ? "publication-manifest.json"
          : new URL(url).pathname.replace(/^\//, "");
      if (file === "publication-manifest.json")
        return {
          status: 200,
          bytes: new TextEncoder().encode(JSON.stringify(manifest)),
        };
      return { status: 200, bytes: expected.get(file) };
    },
  };
  const report = await verifyFreeArtifactPublicFiles(
    transport,
    "https://deployment.example",
    artifact,
  );
  expect(report.projectId).toBe(artifact.expectedProject.id);
  expect(report.files).toHaveLength(artifact.expectedFiles.length);
});

it("rejects a tampered public referenced model before accepting the release", async () => {
  const artifact = await loadFreeArtifact(ZIP, {
    projectId: "pub-free-tampered-fixture",
  });
  const expected = new Map(
    artifact.expectedFiles.map((file) => [file.file, file.data]),
  );
  const model = artifact.expectedFiles.find(
    (file) => file.kind === "generated-glb",
  );
  expect(model).toBeDefined();
  const tampered = new Uint8Array(model!.data);
  tampered[0] ^= 1;
  expected.set(model!.file, tampered);
  const projectBytes = new TextEncoder().encode(
    JSON.stringify(artifact.expectedProject),
  );
  expected.set("project.json", projectBytes);
  const manifest = {
    version: 4,
    projectId: artifact.expectedProject.id,
    revision: 1,
    files: [
      {
        file: "project.json",
        bytes: projectBytes.byteLength,
        sha256: sha256(projectBytes),
      },
      ...artifact.expectedFiles.map(({ file, bytes, sha256: hash }) => ({
        file,
        bytes,
        sha256: hash,
      })),
    ],
  };
  const transport = {
    publicGetBytes: async (url: string) => {
      const file = new URL(url).pathname.replace(/^\//, "");
      if (file === "publication-manifest.json")
        return {
          status: 200,
          bytes: new TextEncoder().encode(JSON.stringify(manifest)),
        };
      return { status: 200, bytes: expected.get(file) };
    },
  };
  await expect(
    verifyFreeArtifactPublicFiles(
      transport,
      "https://deployment.example",
      artifact,
    ),
  ).rejects.toThrow("integrity");
});
