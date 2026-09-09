import { expect, it } from "vitest";
import {
  blankProject,
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
