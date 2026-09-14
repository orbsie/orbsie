import { expect, it } from "vitest";
import {
  applyModelOperation,
  applyOperation,
  blankProject,
  type Project,
} from "../src/lib/protocol";
import {
  createSceneBinding,
  initialSceneProvenance,
  updateSceneProvenance,
} from "../src/lib/scene-binding";
import { hashBrowserProceduralSource } from "../src/lib/browser-procedural";

const source = {
  version: 1 as const,
  language: "quickjs" as const,
  code: "export default { version: 1, output: 'body', nodes: [{ id: 'body', kind: 'box', size: [1, 1, 1] }] }",
  seed: 17,
};
const recipe = {
  version: 1 as const,
  revision: 0,
  output: "body",
  nodes: [
    {
      id: "body",
      kind: "box" as const,
      size: [1, 1, 1] as [number, number, number],
    },
  ],
};

async function projectWithSource() {
  const project = blankProject();
  const sourceHash = await hashBrowserProceduralSource(source);
  project.entities = [
    {
      id: "body",
      label: "Body",
      position: [0, 1, 0],
      scale: [1, 1, 1],
      color: "#abcdef",
      stage: "ready",
      geometry: {
        kind: "generated",
        collision: "platform",
        detail: "refined",
        tint: "#abcdef",
        job: {
          backend: "browser-manifold",
          recipe,
          authoring: { source, sourceHash },
        },
        model: {
          version: 1,
          sha256: "a".repeat(64),
          bytes: 1024,
          source: "browser-manifold",
          kernelVersion: "test",
          bounds: { min: [-1, -1, -1], max: [1, 1, 1] },
          createdAt: "2026-09-13T00:00:00.000Z",
        },
      },
    },
  ];
  return project;
}

it("binds authored geometry deterministically while omitting messages and mesh caches", async () => {
  const project = await projectWithSource();
  const first = await createSceneBinding(project);
  const changed = structuredClone(project) as Project;
  changed.messages = [{ role: "assistant", text: "A transient answer" }];
  const changedGeometry = changed.entities[0].geometry;
  if (!changedGeometry || changedGeometry.kind !== "generated")
    throw Error("Test fixture geometry is not generated.");
  changedGeometry.model = {
    ...changedGeometry.model!,
    sha256: "b".repeat(64),
  };
  const second = await createSceneBinding(changed);
  expect(second.digest).toBe(first.digest);
  expect(second.projectId).toBe(project.id);
  expect(second.revision).toBe(project.revision);
  expect(JSON.stringify(second.projection)).not.toContain("Transient answer");
  expect(JSON.stringify(second.projection)).not.toContain('"model"');
  expect(JSON.stringify(second.projection)).toContain("quickjs");
});

it("changes binding when authored state changes and preserves source replacement/removal provenance", async () => {
  const project = await projectWithSource();
  const baseline = await createSceneBinding(project);
  const moved = structuredClone(project) as Project;
  moved.entities[0].position = [2, 1, 0];
  expect((await createSceneBinding(moved)).digest).not.toBe(baseline.digest);

  const replacement = {
    ...source,
    code: `${source.code} `,
  };
  const replacementHash = await hashBrowserProceduralSource(replacement);
  const provenance = initialSceneProvenance(project);
  updateSceneProvenance(provenance, {
    type: "set_geometry",
    id: "body",
    geometry: {
      kind: "generated",
      collision: "none",
      detail: "refined",
      job: { backend: "browser-procedural", source: replacement },
    },
  });
  const replaced = structuredClone(project) as Project;
  replaced.entities[0].geometry = undefined;
  replaced.revision += 1;
  expect((await createSceneBinding(replaced, provenance)).digest).not.toBe(
    baseline.digest,
  );
  expect((await createSceneBinding(replaced, provenance)).projection).toEqual(
    expect.objectContaining({
      entities: [expect.objectContaining({ id: "body" })],
    }),
  );
  expect(replacementHash).toMatch(/^[a-f0-9]{64}$/);
  updateSceneProvenance(provenance, { type: "remove_entity", id: "body" });
  const removed = await createSceneBinding(replaced, provenance);
  expect(removed.projection).toEqual(
    expect.objectContaining({
      entities: [expect.objectContaining({ id: "body" })],
    }),
  );
  expect(
    (removed.projection as { entities: Array<Record<string, unknown>> })
      .entities[0],
  ).not.toHaveProperty("geometry");
});

it.each([
  ["title", (project: Project) => (project.title = "Another world")],
  ["project id", (project: Project) => (project.id = "other-project")],
  ["revision", (project: Project) => (project.revision += 1)],
  [
    "transform",
    (project: Project) => (project.entities[0].position = [0, 2, 0]),
  ],
  [
    "behavior",
    (project: Project) => (project.entities[0].behavior = { type: "collect" }),
  ],
  [
    "asset policy",
    (project: Project) => (project.entities[0].assetPolicy = "new-only"),
  ],
  [
    "unrelated entity",
    (project: Project) =>
      project.entities.push({
        id: "extra",
        label: "Extra",
        position: [3, 0, 0],
        scale: [1, 1, 1],
        color: "#123456",
        stage: "seed",
      }),
  ],
  [
    "game",
    (project: Project) =>
      (project.game = {
        variables: [],
        rules: [],
      }),
  ],
])("changes the digest when authored %s changes", async (_label, mutate) => {
  const baseline = await projectWithSource();
  const first = await createSceneBinding(baseline);
  const changed = structuredClone(baseline) as Project;
  mutate(changed);
  expect((await createSceneBinding(changed)).digest).not.toBe(first.digest);
});

it("rejects provenance that would hide an unrelated geometry replacement", async () => {
  const project = await projectWithSource();
  const provenance = initialSceneProvenance(project);
  const replaced = structuredClone(project) as Project;
  replaced.entities[0].geometry = {
    kind: "custom",
    detail: "refined",
    parts: [
      {
        shape: "box",
        position: [0, 0, 0],
        scale: [1, 1, 1],
        color: "#123456",
      },
    ],
  };
  await expect(createSceneBinding(replaced, provenance)).rejects.toThrow(
    "does not match entity geometry",
  );
});

it("keeps ordinary browser-manifold recipes while normalizing authored jobs to source", async () => {
  const project = await projectWithSource();
  const ordinary = structuredClone(project) as Project;
  const ordinaryGeometry = ordinary.entities[0].geometry;
  if (!ordinaryGeometry || ordinaryGeometry.kind !== "generated")
    throw Error("Test fixture geometry is not generated.");
  ordinaryGeometry.job = { backend: "browser-manifold", recipe };
  const binding = await createSceneBinding(ordinary);
  expect(JSON.stringify(binding.projection)).toContain('"recipe"');
  expect(JSON.stringify(binding.projection)).not.toContain('"model"');
});

it("matches the server shadow binding to the browser-normalized procedural project", async () => {
  const sourceHash = await hashBrowserProceduralSource(source);
  const server = await projectWithSource();
  server.entities[0].geometry = undefined;
  server.entities[0].stage = "ready";
  server.revision = 0;
  const cursor = {
    runId: "binding-run",
    sequence: 0,
    seen: new Set<string>(),
  };
  const procedural = {
    type: "set_geometry" as const,
    id: "body",
    geometry: {
      kind: "generated" as const,
      collision: "platform" as const,
      detail: "refined" as const,
      tint: "#abcdef",
      job: { backend: "browser-procedural" as const, source },
    },
  };
  const raw = {
    version: 1 as const,
    projectId: server.id,
    runId: cursor.runId,
    operationId: "set-procedural",
    sequence: 1,
    baseRevision: server.revision,
    command: procedural,
  };
  const serverApplied = applyModelOperation(server, raw, cursor);
  const serverProvenance = initialSceneProvenance(server);
  updateSceneProvenance(serverProvenance, procedural);
  const serverBinding = await createSceneBinding(
    serverApplied.project,
    serverProvenance,
  );

  const client = structuredClone(server) as Project;
  const clientApplied = applyOperation(
    client,
    {
      ...raw,
      operationId: "set-browser-normalized",
      command: {
        ...procedural,
        geometry: {
          ...procedural.geometry,
          job: {
            backend: "browser-manifold" as const,
            recipe,
            authoring: { source, sourceHash },
          },
          model: {
            version: 1,
            sha256: "d".repeat(64),
            bytes: 1024,
            source: "browser-manifold" as const,
            kernelVersion: "test",
            bounds: { min: [-1, -1, -1], max: [1, 1, 1] },
            createdAt: "2026-09-13T00:00:00.000Z",
          },
        },
      },
    },
    cursor,
  );
  const clientBinding = await createSceneBinding(clientApplied.project);
  expect(clientBinding.digest).toBe(serverBinding.digest);

  const material = {
    ...raw,
    operationId: "set-material",
    sequence: 2,
    baseRevision: serverApplied.project.revision,
    command: { type: "set_material" as const, id: "body", color: "#123456" },
  };
  const serverMaterial = applyModelOperation(
    serverApplied.project,
    material,
    serverApplied.cursor,
  );
  updateSceneProvenance(serverProvenance, material.command);
  const clientMaterial = applyOperation(
    clientApplied.project,
    material,
    clientApplied.cursor,
  );
  expect(
    (await createSceneBinding(serverMaterial.project, serverProvenance)).digest,
  ).toBe((await createSceneBinding(clientMaterial.project)).digest);

  const replacementSource = { ...source, code: `${source.code} ` };
  const replacementHash = await hashBrowserProceduralSource(replacementSource);
  const replacementCommand = {
    type: "set_geometry" as const,
    id: "body",
    geometry: {
      kind: "generated" as const,
      collision: "none" as const,
      detail: "refined" as const,
      job: {
        backend: "browser-procedural" as const,
        source: replacementSource,
      },
    },
  };
  const replacementRaw = {
    ...material,
    operationId: "replace-procedural",
    sequence: 3,
    baseRevision: serverMaterial.project.revision,
    command: replacementCommand,
  };
  const serverReplaced = applyModelOperation(
    serverMaterial.project,
    replacementRaw,
    serverMaterial.cursor,
  );
  updateSceneProvenance(serverProvenance, replacementCommand);
  const clientReplaced = applyOperation(
    clientMaterial.project,
    {
      ...replacementRaw,
      operationId: "replace-browser-normalized",
      command: {
        ...replacementCommand,
        geometry: {
          ...replacementCommand.geometry,
          job: {
            backend: "browser-manifold" as const,
            recipe,
            authoring: {
              source: replacementSource,
              sourceHash: replacementHash,
            },
          },
          model: {
            version: 1,
            sha256: "e".repeat(64),
            bytes: 1024,
            source: "browser-manifold" as const,
            kernelVersion: "test",
            bounds: { min: [-1, -1, -1], max: [1, 1, 1] },
            createdAt: "2026-09-13T00:00:00.000Z",
          },
        },
      },
    },
    clientMaterial.cursor,
  );
  expect(
    (await createSceneBinding(serverReplaced.project, serverProvenance)).digest,
  ).toBe((await createSceneBinding(clientReplaced.project)).digest);

  const removeCommand = { type: "remove_entity" as const, id: "body" };
  const removeRaw = {
    ...replacementRaw,
    operationId: "remove-procedural",
    sequence: 4,
    baseRevision: serverReplaced.project.revision,
    command: removeCommand,
  };
  const serverRemoved = applyModelOperation(
    serverReplaced.project,
    removeRaw,
    serverReplaced.cursor,
  );
  updateSceneProvenance(serverProvenance, removeCommand);
  const clientRemoved = applyOperation(
    clientReplaced.project,
    { ...removeRaw, operationId: "remove-browser-normalized" },
    clientReplaced.cursor,
  );
  expect(
    (await createSceneBinding(serverRemoved.project, serverProvenance)).digest,
  ).toBe((await createSceneBinding(clientRemoved.project)).digest);
});

it("rejects persisted procedural hashes that no longer match their source", async () => {
  const project = await projectWithSource();
  const geometry = project.entities[0].geometry;
  if (
    !geometry ||
    geometry.kind !== "generated" ||
    !("backend" in geometry.job) ||
    geometry.job.backend !== "browser-manifold" ||
    !("authoring" in geometry.job) ||
    !geometry.job.authoring
  )
    throw Error("Test fixture geometry is not authored.");
  geometry.job.authoring.sourceHash = "c".repeat(64);
  expect(() => initialSceneProvenance(project)).not.toThrow();
  await expect(createSceneBinding(project)).rejects.toThrow(
    "mismatched procedural source hash",
  );
});

it("rejects a corrupted persisted authoring hash even with a valid explicit sidecar", async () => {
  const project = await projectWithSource();
  const sidecar = initialSceneProvenance(project);
  const geometry = project.entities[0].geometry;
  if (
    !geometry ||
    geometry.kind !== "generated" ||
    !("backend" in geometry.job) ||
    geometry.job.backend !== "browser-manifold" ||
    !("authoring" in geometry.job) ||
    !geometry.job.authoring
  )
    throw Error("Test fixture geometry is not authored.");
  geometry.job.authoring.sourceHash = "c".repeat(64);
  await expect(createSceneBinding(project, sidecar)).rejects.toThrow(
    "mismatched procedural source hash",
  );
});

it("rejects provenance when authored collision or source bytes diverge", async () => {
  const project = await projectWithSource();
  const provenance = initialSceneProvenance(project);
  const changed = structuredClone(project) as Project;
  const geometry = changed.entities[0].geometry;
  if (!geometry || geometry.kind !== "generated")
    throw Error("Test fixture geometry is not generated.");
  geometry.collision = "none";
  await expect(createSceneBinding(changed, provenance)).rejects.toThrow(
    "does not match entity geometry",
  );

  const sourceChanged = structuredClone(project) as Project;
  const sourceGeometry = sourceChanged.entities[0].geometry;
  if (!sourceGeometry || sourceGeometry.kind !== "generated")
    throw Error("Test fixture geometry is not generated.");
  if (!(
    "backend" in sourceGeometry.job &&
    sourceGeometry.job.backend === "browser-manifold" &&
    "authoring" in sourceGeometry.job &&
    sourceGeometry.job.authoring
  ))
    throw Error("Test fixture geometry is not authored.");
  sourceGeometry.job.authoring.source = { ...source, code: `${source.code} ` };
  await expect(createSceneBinding(sourceChanged, provenance)).rejects.toThrow(
    "does not match entity geometry",
  );
});
