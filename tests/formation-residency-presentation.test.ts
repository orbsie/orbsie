import { describe, expect, it } from "vitest";
import { Matrix4, Quaternion, Vector3 } from "three";
import { entitySchema, groupSchema, type Project } from "../src/lib/protocol";
import { resolveRuntimeScene } from "../src/lib/scene-runtime";
import { worldNavigationBoundsByEntity } from "../src/lib/world-navigation-bounds";
import {
  formationProxyReviewSnapshot,
  formationProxyVisualBounds,
  playbackFormationResidencyFocusCell,
  selectFormationResidencyPresentation,
  type FormationResidencyPresentationCandidate,
} from "../src/lib/formation-residency-presentation";

function completedCandidate(
  id: string,
  x: number,
): FormationResidencyPresentationCandidate {
  return {
    id,
    stage: "ready",
    recipeIdentity: `recipe:${id}`,
    completedRecipeIdentity: `recipe:${id}`,
    worldCenter: [x, 0, 0],
  };
}

describe("formation residency presentation", () => {
  it("caps completed full formations and leaves cheap proxies for the rest", () => {
    const candidates = Array.from({ length: 160 }, (_, index) =>
      completedCandidate(`ready-${String(index).padStart(3, "0")}`, index),
    );
    const visibleIds = new Set(candidates.map(({ id }) => id));
    const result = selectFormationResidencyPresentation({
      candidates,
      focus: [0, 0, 0],
      visibleIds,
      enabled: true,
    });

    expect(result.residentIds.size).toBe(48);
    expect(result.fullFormationIds.size).toBe(48);
    expect(result.proxyIds.size).toBe(112);
    expect(result.proxyIds.has("ready-159")).toBe(true);
  });

  it("promotes selected and visible recipes while keeping incomplete or unplaceable entities full", () => {
    const candidates = [
      completedCandidate("near", 0),
      completedCandidate("far-selected", 900),
      completedCandidate("far-visible", 1_200),
      {
        id: "new-recipe",
        stage: "ready" as const,
        recipeIdentity: "recipe:new",
        completedRecipeIdentity: "recipe:old",
        worldCenter: [2, 0, 0] as const,
      },
      {
        id: "forming",
        stage: "coarse" as const,
        recipeIdentity: "recipe:forming",
        completedRecipeIdentity: "recipe:forming",
        worldCenter: [3, 0, 0] as const,
      },
      {
        id: "unknown-center",
        stage: "ready" as const,
        recipeIdentity: "recipe:unknown-center",
        completedRecipeIdentity: "recipe:unknown-center",
      },
    ];
    const result = selectFormationResidencyPresentation({
      candidates,
      focus: [0, 0, 0],
      selectedId: "far-selected",
      visibleIds: new Set(["far-visible"]),
      previousResidentIds: new Set(["near"]),
      enabled: true,
    });

    expect(result.residentIds.has("far-selected")).toBe(true);
    expect(result.residentIds.has("far-visible")).toBe(true);
    expect(result.residentIds.has("near")).toBe(true);
    for (const id of ["new-recipe", "forming", "unknown-center"])
      expect(result.fullFormationIds.has(id)).toBe(true);
    expect(result.proxyIds.has("unknown-center")).toBe(false);
  });

  it("uses selection and current visibility ahead of distance when capacity is tight", () => {
    const candidates = [
      completedCandidate("near", 0),
      completedCandidate("visible", 800),
      completedCandidate("selected", 1_200),
    ];
    const selected = selectFormationResidencyPresentation({
      candidates,
      focus: [0, 0, 0],
      visibleIds: new Set(["visible"]),
      selectedId: "selected",
      maxResidents: 1,
      enabled: true,
    });
    expect(selected.residentIds).toEqual(new Set(["selected"]));

    const visible = selectFormationResidencyPresentation({
      candidates,
      focus: [0, 0, 0],
      visibleIds: new Set(["visible"]),
      maxResidents: 1,
      enabled: true,
    });
    expect(visible.residentIds).toEqual(new Set(["visible"]));
  });

  it("keeps all formations mounted until the settled scene enables residency", () => {
    const candidates = [completedCandidate("completed", 100_000)];
    const result = selectFormationResidencyPresentation({
      candidates,
      focus: [0, 0, 0],
      visibleIds: new Set(),
      enabled: false,
    });

    expect(result.fullFormationIds.has("completed")).toBe(true);
    expect(result.proxyIds.size).toBe(0);
    expect(result.residentIds.size).toBe(0);
  });

  it("retains a resident through the hysteresis band, then releases it", () => {
    const insideEdge = completedCandidate("edge", 250);
    const first = selectFormationResidencyPresentation({
      candidates: [insideEdge],
      focus: [0, 0, 0],
      visibleIds: new Set(),
      enabled: true,
    });
    expect(first.residentIds.has("edge")).toBe(true);

    const acrossEdge = completedCandidate("edge", 300);
    const retained = selectFormationResidencyPresentation({
      candidates: [acrossEdge],
      focus: [0, 0, 0],
      visibleIds: new Set(),
      previousResidentIds: first.residentIds,
      enabled: true,
    });
    expect(retained.residentIds.has("edge")).toBe(true);

    const beyondHysteresis = completedCandidate("edge", 321);
    const released = selectFormationResidencyPresentation({
      candidates: [beyondHysteresis],
      focus: [0, 0, 0],
      visibleIds: new Set(),
      previousResidentIds: retained.residentIds,
      enabled: true,
    });
    expect(released.residentIds.has("edge")).toBe(false);
    expect(released.proxyIds.has("edge")).toBe(true);
  });

  it("changes playback focus only across bounded cells, including far and negative coordinates", () => {
    const start = playbackFormationResidencyFocusCell([1, 0.5, 1]);
    const sameCell = playbackFormationResidencyFocusCell([
      127.99, 15.9, 127.99,
    ]);
    expect(sameCell.key).toBe(start.key);
    expect(sameCell.focus).toEqual(start.focus);

    const crossed = playbackFormationResidencyFocusCell([128, 0.5, 1]);
    expect(crossed.key).not.toBe(start.key);
    expect(crossed.focus[0]).toBe(192);

    const negative = playbackFormationResidencyFocusCell([-0.01, -0.01, -128]);
    expect(negative.focus).toEqual([-64, -8, -64]);
    const far = playbackFormationResidencyFocusCell([
      1_000_000, 0.5, -1_000_000,
    ]);
    expect(far.focus).toEqual([1_000_000, 8, -1_000_000]);
  });

  it("moves residency toward the playback focus after a far travel step", () => {
    const destination = completedCandidate("destination", 10_000);
    const startFocus = playbackFormationResidencyFocusCell([0, 0.5, 5]);
    const beforeTravel = selectFormationResidencyPresentation({
      candidates: [destination],
      focus: startFocus.focus,
      visibleIds: new Set(),
      enabled: true,
    });
    expect(beforeTravel.proxyIds.has(destination.id)).toBe(true);

    const farFocus = playbackFormationResidencyFocusCell([10_000, 0.5, 0]);
    const afterTravel = selectFormationResidencyPresentation({
      candidates: [destination],
      focus: farFocus.focus,
      visibleIds: new Set(),
      enabled: true,
    });
    expect(afterTravel.residentIds.has(destination.id)).toBe(true);
  });

  it("places proxy bounds from geometry transformed through rotated far groups", () => {
    const project: Project = {
      version: 1,
      id: "grouped-proxy-bounds",
      title: "Grouped proxy bounds",
      seed: 1,
      revision: 2,
      entities: [
        entitySchema.parse({
          id: "leaf",
          label: "Leaf",
          stage: "ready",
          parentId: "rotated-group",
          position: [4, 0, 0],
          geometry: {
            kind: "custom",
            detail: "refined",
            parts: [
              {
                shape: "box",
                position: [1, 0, 0],
                scale: [2, 2, 2],
                rotation: [0, 0, 0],
                color: "#ffffff",
              },
            ],
          },
        }),
      ],
      groups: [
        groupSchema.parse({
          id: "rotated-group",
          label: "Rotated group",
          position: [100_000, 3, -200_000],
          rotation: [0, Math.PI / 2, 0],
          scale: [2, 1, 3],
        }),
      ],
      environment: { sky: "#ffffff", ground: "#ffffff", water: "#ffffff" },
      messages: [],
    };
    const node = resolveRuntimeScene(project).entities.get("leaf");
    const worldBounds = worldNavigationBoundsByEntity(project).get("leaf");
    expect(node).toBeDefined();
    expect(worldBounds).toBeDefined();

    const visualBounds = formationProxyVisualBounds(worldBounds, node);
    expect(visualBounds?.center[0]).toBeCloseTo(100_000);
    expect(visualBounds?.center[1]).toBeCloseTo(3);
    expect(visualBounds?.center[2]).toBeCloseTo(-200_010);
    expect(visualBounds?.size[0]).toBeCloseTo(6);
    expect(visualBounds?.size[1]).toBeCloseTo(2);
    expect(visualBounds?.size[2]).toBeCloseTo(4);
  });

  it("uses a conservative rotated transform fallback and rejects invalid placement", () => {
    const affine = new Matrix4().compose(
      new Vector3(12_000, 7, -9_000),
      new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 4),
      new Vector3(2, 3, 4),
    );
    const fallback = formationProxyVisualBounds(undefined, {
      worldMatrix: affine,
      worldPosition: [12_000, 7, -9_000],
    });
    expect(fallback?.center).toEqual([12_000, 7, -9_000]);
    expect(fallback?.size[0]).toBeGreaterThan(4);
    expect(fallback?.size[1]).toBeCloseTo(6);
    expect(fallback?.size[2]).toBeGreaterThan(8);
    expect(
      formationProxyVisualBounds(undefined, {
        worldMatrix: affine,
        worldPosition: [Number.NaN, 0, 0],
      }),
    ).toBeUndefined();
  });

  it("lets completed offscreen proxies pass review and waits for visible draws", () => {
    expect(formationProxyReviewSnapshot(4, undefined, false)).toEqual({
      ready: true,
      pending: false,
      failed: false,
      renderedRevision: 4,
    });
    expect(formationProxyReviewSnapshot(4, undefined, true)).toEqual({
      ready: false,
      pending: true,
      failed: false,
      renderedRevision: -1,
    });
    expect(formationProxyReviewSnapshot(4, 3, true)).toMatchObject({
      ready: false,
      pending: true,
      renderedRevision: 3,
    });
    expect(formationProxyReviewSnapshot(4, 4, true)).toMatchObject({
      ready: true,
      pending: false,
      renderedRevision: 4,
    });

    const initiallyVisible = formationProxyReviewSnapshot(4, undefined, true);
    const hiddenBeforeDrawing = formationProxyReviewSnapshot(
      4,
      undefined,
      false,
    );
    const visibleAgainBeforeDrawing = formationProxyReviewSnapshot(
      4,
      undefined,
      true,
    );
    const visibleAfterDrawing = formationProxyReviewSnapshot(4, 4, true);
    expect(initiallyVisible.ready).toBe(false);
    expect(hiddenBeforeDrawing.ready).toBe(true);
    expect(visibleAgainBeforeDrawing.ready).toBe(false);
    expect(visibleAfterDrawing.ready).toBe(true);
  });
});
