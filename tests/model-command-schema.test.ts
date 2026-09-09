import { expect, it } from "vitest";
import {
  BROWSER_PROCEDURAL_SOURCE_MAX_BYTES,
  browserProceduralSourceSchema,
} from "../src/lib/browser-procedural";
import {
  blankProject,
  applyModelOperation,
  modelCommandJSONSchemaForCapabilities,
  modelCommandSchemaForCapabilities,
  projectSchema,
} from "../src/lib/protocol";

const browserJob = {
  backend: "browser-manifold" as const,
  recipe: {
    version: 1 as const,
    revision: 0,
    output: "box" as const,
    nodes: [
      {
        id: "box",
        kind: "box" as const,
        size: [2, 2, 2] as [number, number, number],
      },
    ],
  },
};
const legacyJob = {
  version: 1 as const,
  parts: [{ id: "body", shape: "box" as const, color: "#ffffff" }],
};
const browserGeometry = {
  kind: "generated" as const,
  detail: "refined" as const,
  job: browserJob,
};
const proceduralSource = {
  version: 1 as const,
  language: "quickjs" as const,
  seed: 3,
  code: `({version:1,revision:0,output:"box",nodes:[{id:"box",kind:"box",size:[2,2,2]}]})`,
};
const oversizedProceduralSource = {
  version: 1 as const,
  language: "quickjs" as const,
  seed: 3,
  code: "é".repeat(Math.ceil(BROWSER_PROCEDURAL_SOURCE_MAX_BYTES / 2) + 1),
};

function setGeometry(geometry: unknown) {
  return {
    type: "set_geometry" as const,
    id: "tree-0",
    geometry,
  };
}

it("advertises and accepts only browser recipes for browser capability", () => {
  const schema = modelCommandSchemaForCapabilities(false, true);
  expect(schema.safeParse(setGeometry(browserGeometry)).success).toBe(true);
  expect(
    schema.safeParse(
      setGeometry({
        kind: "generated",
        detail: "refined",
        job: { backend: "browser-procedural", source: proceduralSource },
      }),
    ).success,
  ).toBe(true);
  expect(
    schema.safeParse(
      setGeometry({
        ...browserGeometry,
        job: legacyJob,
      }),
    ).success,
  ).toBe(false);
  expect(
    schema.safeParse(
      setGeometry({
        ...browserGeometry,
        model: { source: "browser-manifold" },
      }),
    ).success,
  ).toBe(false);
  expect(
    schema.safeParse({
      type: "reserve_entity",
      entity: {
        id: "tree-0",
        label: "Tree",
        position: [0, 0, 0],
        scale: [1, 1, 1],
        color: "#6d9d58",
        geometry: browserGeometry,
        stage: "seed",
      },
    }).success,
  ).toBe(false);
  expect(
    schema.safeParse({
      type: "reserve_entity",
      entity: {
        id: "tree-0",
        label: "Tree",
        position: [0, 0, 0],
        scale: [1, 1, 1],
        color: "#6d9d58",
        stage: "seed",
      },
    }).success,
  ).toBe(true);
});

it("keeps procedural source out of canonical commands and rejects provider metadata", () => {
  const procedural = setGeometry({
    kind: "generated",
    detail: "refined",
    job: { backend: "browser-procedural", source: proceduralSource },
  });
  expect(() =>
    projectSchema.parse({ ...blankProject(), entities: [] }),
  ).not.toThrow();
  expect(() =>
    projectSchema.parse({
      ...blankProject(),
      entities: [
        {
          id: "tree-0",
          label: "Tree",
          position: [0, 0, 0],
          scale: [1, 1, 1],
          color: "#6d9d58",
          stage: "ready",
          geometry: {
            ...browserGeometry,
            job: {
              backend: "browser-manifold",
              recipe: browserJob.recipe,
              authoring: {
                source: proceduralSource,
                sourceHash: "a".repeat(64),
              },
            },
          },
        },
      ],
    }),
  ).not.toThrow();
  expect(
    modelCommandSchemaForCapabilities(false, true).safeParse({
      type: "set_geometry",
      id: "tree-0",
      geometry: {
        kind: "generated",
        detail: "refined",
        job: {
          backend: "browser-procedural",
          source: proceduralSource,
          authoring: { source: proceduralSource, sourceHash: "a".repeat(64) },
        },
      },
    }).success,
  ).toBe(false);
});

it("rejects oversized procedural source at raw, model-output, and canonical-project boundaries", () => {
  expect(
    browserProceduralSourceSchema.safeParse(oversizedProceduralSource).success,
  ).toBe(false);
  expect(
    modelCommandSchemaForCapabilities(false, true).safeParse({
      type: "set_geometry",
      id: "tree-0",
      geometry: {
        kind: "generated",
        detail: "refined",
        job: {
          backend: "browser-procedural",
          source: oversizedProceduralSource,
        },
      },
    }).success,
  ).toBe(false);
  expect(
    projectSchema.safeParse({
      ...blankProject(),
      entities: [
        {
          id: "tree-0",
          label: "Tree",
          position: [0, 0, 0],
          scale: [1, 1, 1],
          color: "#6d9d58",
          stage: "ready",
          geometry: {
            kind: "generated",
            collision: "none",
            detail: "refined",
            job: {
              backend: "browser-manifold",
              recipe: browserJob.recipe,
              authoring: {
                source: oversizedProceduralSource,
                sourceHash: "a".repeat(64),
              },
            },
          },
        },
      ],
    }).success,
  ).toBe(false);
});

it("omits generated jobs when no modeling capability is available", () => {
  const schema = modelCommandSchemaForCapabilities(false, false);
  expect(schema.safeParse(setGeometry(browserGeometry)).success).toBe(false);
  expect(
    schema.safeParse({
      type: "set_geometry",
      id: "tree-0",
      geometry: { kind: "tree", detail: "refined" },
    }).success,
  ).toBe(true);
});

it("keeps full project decoding compatible with saved legacy baked models", () => {
  const project = {
    ...blankProject(),
    entities: [
      {
        id: "tree-0",
        label: "Saved tree",
        position: [0, 0, 0],
        scale: [1, 1, 1],
        color: "#6d9d58",
        stage: "ready",
        geometry: {
          kind: "generated" as const,
          detail: "refined" as const,
          job: legacyJob,
          model: {
            version: 1 as const,
            sha256: "a".repeat(64),
            bytes: 32,
            source: "local-blender" as const,
            blenderVersion: "4.0.2",
            bounds: { min: [0, 0, 0], max: [1, 1, 1] },
            createdAt: "2026-09-08T00:00:00.000Z",
          },
        },
      },
    ],
  };
  expect(projectSchema.parse(project).entities[0].geometry).toMatchObject({
    kind: "generated",
    model: { source: "local-blender" },
  });
});

it("caches each capability JSON schema and excludes trusted metadata", () => {
  const first = modelCommandJSONSchemaForCapabilities(false, true);
  expect(modelCommandJSONSchemaForCapabilities(false, true)).toBe(first);
  const browserJSON = JSON.stringify(first);
  expect(browserJSON).toContain("browser-manifold");
  expect(browserJSON).not.toContain("local-blender");
  expect(browserJSON).not.toContain('"model"');
  const noneJSON = JSON.stringify(
    modelCommandJSONSchemaForCapabilities(false, false),
  );
  expect(noneJSON).not.toContain("browser-manifold");
  expect(noneJSON).not.toContain("local-blender");
  expect(noneJSON).not.toContain('"model"');
});

it("projects a procedural command for later references without persisting its source", () => {
  const project = {
    ...blankProject(),
    entities: [
      {
        id: "tree-0",
        label: "Tree",
        position: [0, 0, 0] as [number, number, number],
        scale: [1, 1, 1] as [number, number, number],
        color: "#6d9d58",
        stage: "seed" as const,
      },
    ],
  };
  const command = {
    type: "set_geometry" as const,
    id: "tree-0",
    geometry: {
      kind: "generated" as const,
      collision: "none" as const,
      detail: "refined" as const,
      job: { backend: "browser-procedural" as const, source: proceduralSource },
    },
    assetPolicy: "new-only" as const,
  };
  const cursor = { runId: "run", sequence: 0, seen: new Set<string>() };
  const shadow = applyModelOperation(
    project,
    {
      version: 1,
      projectId: project.id,
      runId: "run",
      operationId: "op-1",
      sequence: 1,
      baseRevision: 0,
      command,
    },
    cursor,
  );
  expect(shadow.project.entities[0]).toMatchObject({
    id: "tree-0",
    stage: "ready",
    assetPolicy: "new-only",
  });
  expect(JSON.stringify(shadow.project)).not.toContain("browser-procedural");
  const next = applyModelOperation(
    shadow.project,
    {
      version: 1,
      projectId: project.id,
      runId: "run",
      operationId: "op-2",
      sequence: 2,
      baseRevision: 1,
      command: {
        type: "set_game",
        game: {
          variables: [],
          rules: [],
        },
      },
    },
    shadow.cursor,
  );
  expect(next.project.revision).toBe(2);
});

it("does not let a replaced catalog mesh poison later shadow updates", () => {
  const project = {
    ...blankProject(),
    entities: [
      {
        id: "tree-0",
        label: "Catalog tree",
        position: [0, 0, 0] as [number, number, number],
        scale: [1, 1, 1] as [number, number, number],
        color: "#6d9d58",
        geometry: {
          kind: "asset" as const,
          assetId: "kenney.nature.tree-default" as const,
          detail: "refined" as const,
        },
        stage: "ready" as const,
        assetPolicy: "catalog-allowed" as const,
      },
    ],
  };
  const cursor = { runId: "run", sequence: 0, seen: new Set<string>() };
  const shadow = applyModelOperation(
    project,
    {
      version: 1,
      projectId: project.id,
      runId: "run",
      operationId: "replace",
      sequence: 1,
      baseRevision: 0,
      command: {
        type: "set_geometry",
        id: "tree-0",
        assetPolicy: "new-only",
        geometry: {
          kind: "generated",
          collision: "none",
          detail: "refined",
          job: { backend: "browser-procedural", source: proceduralSource },
        },
      },
    },
    cursor,
  );
  expect(shadow.project.entities[0].geometry).toBeUndefined();
  const afterMaterial = applyModelOperation(
    shadow.project,
    {
      version: 1,
      projectId: project.id,
      runId: "run",
      operationId: "material",
      sequence: 2,
      baseRevision: 1,
      command: { type: "set_material", id: "tree-0", color: "#ff0000" },
    },
    shadow.cursor,
  );
  expect(afterMaterial.project.entities[0]).toMatchObject({
    color: "#ff0000",
    assetPolicy: "new-only",
  });
});
