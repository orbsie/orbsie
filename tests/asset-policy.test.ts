import { describe, expect, it } from "vitest";
import {
  AssetPolicyError,
  deriveAssetPolicy,
  enforceAssetPolicy,
} from "../src/lib/asset-policy";
import {
  applyOperation,
  blankProject,
  type Command,
} from "../src/lib/protocol";

function entity(id: string, assetPolicy?: "catalog-allowed" | "new-only") {
  return {
    id,
    label: id,
    position: [0, 0, 0] as [number, number, number],
    scale: [1, 1, 1] as [number, number, number],
    color: "#6ead60",
    geometry: { kind: "tree" as const, detail: "refined" as const },
    assetPolicy,
    stage: "ready" as const,
  };
}

const assetGeometry = {
  kind: "asset" as const,
  assetId: "kenney.nature.tree-default" as const,
  detail: "refined" as const,
};

describe("request-scoped asset policy", () => {
  it("derives selected and whole-request original scopes conservatively", () => {
    const project = {
      ...blankProject(),
      entities: [entity("tree"), entity("protected", "new-only")],
    };
    expect(
      deriveAssetPolicy("Make this an original mushroom", "tree", project),
    ).toMatchObject({
      requestAssetPolicy: "new-only",
      scope: "selected",
      selectedEntityId: "tree",
      explicitNewRequest: true,
      reason: "prompt",
    });
    expect(
      deriveAssetPolicy(
        "Build a brand-new world from scratch",
        undefined,
        project,
      ),
    ).toMatchObject({
      requestAssetPolicy: "new-only",
      scope: "project",
      explicitNewRequest: true,
    });
    expect(
      deriveAssetPolicy(
        "Make the protected object taller",
        "protected",
        project,
      ),
    ).toMatchObject({
      requestAssetPolicy: "new-only",
      scope: "selected",
      reason: "entity-policy",
    });
    expect(
      deriveAssetPolicy(
        "Keep the original color, just make it warmer",
        "tree",
        project,
      ),
    ).toMatchObject({
      requestAssetPolicy: "catalog-allowed",
      explicitNewRequest: false,
    });
    expect(
      deriveAssetPolicy(
        "Keep the original geometry and recolor it",
        "tree",
        project,
      ).explicitNewRequest,
    ).toBe(false);
    expect(
      deriveAssetPolicy(
        "Do not generate a new model; keep the prepared asset",
        "tree",
        project,
      ).explicitNewRequest,
    ).toBe(false);
    expect(
      deriveAssetPolicy("Build an original model", "tree", project)
        .explicitNewRequest,
    ).toBe(true);
  });

  it("stamps new-only reservations and rejects catalog geometry in whole creations", () => {
    const project = blankProject();
    const context = deriveAssetPolicy(
      "Create a brand-new original world",
      undefined,
      project,
    );
    const procedural: Command = {
      type: "reserve_entity",
      entity: entity("original-tree"),
    };
    expect(enforceAssetPolicy(project, procedural, context)).toMatchObject({
      entity: { assetPolicy: "new-only" },
    });
    expect(() =>
      enforceAssetPolicy(
        project,
        {
          ...procedural,
          entity: {
            ...procedural.entity,
            id: "catalog-tree",
            geometry: assetGeometry,
          },
        },
        context,
      ),
    ).toThrowError(AssetPolicyError);
  });

  it("keeps selected edits scoped and blocks remove/recreate bypasses", () => {
    const project = {
      ...blankProject(),
      entities: [entity("selected"), entity("unrelated")],
    };
    const context = deriveAssetPolicy(
      "Turn this into a new original mushroom",
      "selected",
      project,
    );
    const update: Command = {
      type: "set_geometry",
      id: "selected",
      geometry: { kind: "mushroom", detail: "refined" },
    };
    const stamped = enforceAssetPolicy(project, update, context);
    expect(stamped).toMatchObject({ assetPolicy: "new-only" });
    expect(() =>
      enforceAssetPolicy(
        project,
        { type: "set_geometry", id: "selected", geometry: assetGeometry },
        context,
      ),
    ).toThrowError(AssetPolicyError);
    expect(() =>
      enforceAssetPolicy(
        project,
        { type: "remove_entity", id: "selected" },
        context,
      ),
    ).toThrow(/cannot be removed/);
    expect(() =>
      enforceAssetPolicy(
        project,
        { type: "set_material", id: "unrelated", color: "#ff66aa" },
        context,
      ),
    ).toThrow(/scoped/);
  });

  it("requires a ready non-catalog replacement before an explicit selected commit", () => {
    const project = {
      ...blankProject(),
      entities: [
        {
          ...entity("selected"),
          geometry: assetGeometry,
        },
      ],
    };
    const context = deriveAssetPolicy(
      "Make this an original mushroom",
      "selected",
      project,
    );
    expect(() =>
      enforceAssetPolicy(
        project,
        { type: "commit_revision", message: "done" },
        context,
      ),
    ).toThrow(/original geometry|catalog asset/);
    const replaced = {
      ...project,
      entities: [
        {
          ...project.entities[0],
          assetPolicy: "new-only" as const,
          geometry: { kind: "mushroom" as const, detail: "refined" as const },
          stage: "ready" as const,
        },
      ],
    };
    expect(
      enforceAssetPolicy(
        project,
        {
          type: "set_geometry",
          id: "selected",
          geometry: { kind: "mushroom", detail: "refined" },
        },
        context,
      ),
    ).toMatchObject({ assetPolicy: "new-only" });
    expect(
      enforceAssetPolicy(
        replaced,
        { type: "commit_revision", message: "done" },
        context,
      ),
    ).toEqual({ type: "commit_revision", message: "done" });

    const unchangedProcedural = {
      ...blankProject(),
      entities: [entity("selected")],
    };
    const unchangedContext = deriveAssetPolicy(
      "Make this an original mushroom",
      "selected",
      unchangedProcedural,
    );
    expect(() =>
      enforceAssetPolicy(
        unchangedProcedural,
        { type: "commit_revision", message: "done" },
        unchangedContext,
      ),
    ).toThrow(/original geometry/);
  });

  it("honors persisted new-only policy even when a model asks to downgrade it", () => {
    const project = {
      ...blankProject(),
      entities: [entity("tree", "new-only")],
    };
    const context = deriveAssetPolicy("Make it green", "tree", project);
    expect(() =>
      enforceAssetPolicy(
        project,
        {
          type: "set_geometry",
          id: "tree",
          geometry: { kind: "tree", detail: "refined" },
          assetPolicy: "catalog-allowed",
        },
        context,
      ),
    ).toThrow(/downgraded/);
    expect(
      enforceAssetPolicy(
        project,
        { type: "remove_entity", id: "tree" },
        context,
      ),
    ).toEqual({ type: "remove_entity", id: "tree" });
  });

  it("allows catalog assets in ordinary requests and preserves unrelated entities", () => {
    const project = blankProject();
    const context = deriveAssetPolicy("Add a tree", undefined, project);
    const reserve: Command = {
      type: "reserve_entity",
      entity: { ...entity("tree"), geometry: assetGeometry },
    };
    const checked = enforceAssetPolicy(project, reserve, context);
    expect(checked).toEqual(reserve);
    const cursor = { runId: "run", sequence: 0, seen: new Set<string>() };
    const applied = applyOperation(
      project,
      {
        version: 1,
        projectId: project.id,
        runId: "run",
        operationId: "one",
        sequence: 1,
        baseRevision: 0,
        command: checked,
      },
      cursor,
    );
    expect(applied.project.entities[0].geometry).toEqual(assetGeometry);
    expect(applied.project.entities[0].assetPolicy).toBeUndefined();
  });
});
