import { describe, expect, it } from "vitest";
import {
  decodeStrictSceneCommand,
  strictSceneCommandJSONSchemaForCapabilities,
} from "../src/lib/server/strict-scene-schema";
import { parseModelCommandForProcessing } from "../src/lib/protocol";

function absent() {
  return { present: false };
}

function present(value: unknown) {
  return { present: true, value };
}

function transformWire(overrides: Record<string, unknown> = {}) {
  return {
    type: "set_transform",
    id: "tree",
    position: absent(),
    rotation: absent(),
    scale: absent(),
    assetPolicy: absent(),
    ...overrides,
  };
}

function reserveWire(parentId: unknown = absent()) {
  return {
    type: "reserve_entity",
    entity: {
      id: "tree",
      label: "Tree",
      position: [0, 0, 0],
      scale: [1, 1, 1],
      rotation: absent(),
      parentId,
      color: "#88aa55",
      behavior: absent(),
      assetPolicy: absent(),
      stage: "seed",
    },
  };
}

function auditSchema(schema: unknown) {
  const stats = { properties: 0, maxDepth: 0 };
  function visit(value: unknown, depth: number) {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, depth));
      return;
    }
    const record = value as Record<string, unknown>;
    const isObject = record.type === "object" || record.properties;
    if (isObject) {
      const properties =
        record.properties && typeof record.properties === "object"
          ? Object.keys(record.properties as object)
          : [];
      const required = Array.isArray(record.required) ? record.required : [];
      expect(record.additionalProperties).toBe(false);
      expect(required).toEqual(properties);
      stats.properties += properties.length;
      stats.maxDepth = Math.max(stats.maxDepth, depth);
    }
    for (const child of Object.values(record))
      visit(child, isObject ? depth + 1 : depth);
  }
  visit(schema, 0);
  return stats;
}

describe("strict scene wire schema", () => {
  it("projects every optional property into a closed presence wrapper", () => {
    const schema = strictSceneCommandJSONSchemaForCapabilities(false, true);
    const encoded = JSON.stringify(schema);
    expect(encoded).not.toContain('"oneOf"');
    expect(encoded).not.toContain('"prefixItems"');
    expect(encoded).not.toContain('"default"');
    expect(encoded).not.toContain('"$schema"');
    expect(encoded).not.toContain('"allOf"');
    expect(encoded.length).toBeLessThan(60_000);
    expect(encoded.length).toBeGreaterThan(23_992);

    const stats = auditSchema(schema);
    expect(stats.properties).toBeLessThan(5_000);
    expect(stats.maxDepth).toBeLessThanOrEqual(10);
  });

  it("round-trips omitted and supplied transforms without changing omission semantics", () => {
    const omitted = decodeStrictSceneCommand(transformWire(), false, true);
    expect(omitted).toEqual({ type: "set_transform", id: "tree" });
    expect(parseModelCommandForProcessing(omitted, false, true)).toEqual(
      omitted,
    );

    const supplied = decodeStrictSceneCommand(
      transformWire({ position: present([1, 2, 3]) }),
      false,
      true,
    );
    expect(supplied).toEqual({
      type: "set_transform",
      id: "tree",
      position: [1, 2, 3],
    });
  });

  it("preserves omitted versus explicit null for nullable parentId", () => {
    const omitted = decodeStrictSceneCommand(reserveWire(), false, true);
    expect(omitted).toMatchObject({ type: "reserve_entity" });
    expect(omitted).not.toHaveProperty("entity.parentId");

    const explicitNull = decodeStrictSceneCommand(
      reserveWire(present(null)),
      false,
      true,
    );
    expect(explicitNull).toHaveProperty("entity.parentId", null);
    expect(parseModelCommandForProcessing(explicitNull, false, true)).toEqual(
      explicitNull,
    );
  });

  it("rejects null for an optional field whose canonical schema is not nullable", () => {
    expect(() =>
      decodeStrictSceneCommand(
        transformWire({ position: present(null) }),
        false,
        true,
      ),
    ).toThrow();
  });

  it("rejects malformed presence wrappers and extra wrapper keys", () => {
    expect(() =>
      decodeStrictSceneCommand(
        transformWire({ position: { present: false, value: [1, 2, 3] } }),
        false,
        true,
      ),
    ).toThrow();
    expect(() =>
      decodeStrictSceneCommand(
        transformWire({ position: { present: true } }),
        false,
        true,
      ),
    ).toThrow();
  });

  it("round-trips nested optional behavior fields", () => {
    const command = {
      type: "set_behavior",
      id: "platform",
      behavior: {
        type: "move",
        speed: absent(),
        amplitude: present(0.25),
        axis: present("x"),
      },
      assetPolicy: absent(),
    };
    const decoded = decodeStrictSceneCommand(command, false, true);
    expect(decoded).toEqual({
      type: "set_behavior",
      id: "platform",
      behavior: { type: "move", amplitude: 0.25, axis: "x" },
    });
  });

  it("uses discriminator-safe unions and restores heterogeneous recipe tuples", () => {
    const command = {
      type: "set_geometry",
      id: "shape",
      geometry: {
        kind: "generated",
        collision: "none",
        detail: "refined",
        job: {
          backend: "browser-manifold",
          recipe: {
            version: 1,
            revision: 0,
            output: "revolve",
            nodes: [
              {
                id: "revolve",
                kind: "revolve",
                profile: [
                  { item0: 0.2, item1: -0.5 },
                  { item0: 0.4, item1: 0.5 },
                  { item0: 0.2, item1: 1 },
                ],
                segments: 16,
              },
            ],
          },
        },
        tint: absent(),
      },
      assetPolicy: absent(),
    };
    const decoded = decodeStrictSceneCommand(command, false, true);
    expect(decoded).toMatchObject({
      type: "set_geometry",
      geometry: {
        kind: "generated",
        job: {
          recipe: {
            nodes: [
              {
                kind: "revolve",
                profile: [
                  [0.2, -0.5],
                  [0.4, 0.5],
                  [0.2, 1],
                ],
              },
            ],
          },
        },
      },
    });
    expect(parseModelCommandForProcessing(decoded, false, true)).toEqual(
      decoded,
    );
  });

  it("rejects an invalid generated-node discriminator before decoding", () => {
    expect(() =>
      decodeStrictSceneCommand(
        {
          type: "set_geometry",
          id: "shape",
          geometry: {
            kind: "generated",
            collision: "none",
            detail: "refined",
            job: {
              backend: "browser-manifold",
              recipe: {
                version: 1,
                revision: 0,
                output: "box",
                nodes: [{ id: "box", kind: "invalid", size: [1, 1, 1] }],
              },
            },
            tint: absent(),
          },
          assetPolicy: absent(),
        },
        false,
        true,
      ),
    ).toThrow();
  });
});
