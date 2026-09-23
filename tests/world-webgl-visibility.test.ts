import { describe, expect, it } from "vitest";
import { entitySchema, type Project } from "../src/lib/protocol";
import {
  worldNavigationBoundsByEntity,
  type WorldNavigationEntityBounds,
} from "../src/lib/world-navigation-bounds";
import {
  createWorldNavigationState,
  type WorldNavigationBounds,
  type WorldNavigationState,
} from "../src/lib/world-navigation";
import { visibleWebGLNavigationEntityIds } from "../src/components/world";

function projectAtFarWorld(): Project {
  const entity = (id: string, position: [number, number, number]) =>
    entitySchema.parse({
      id,
      label: id,
      position,
      stage: "ready",
      geometry: {
        kind: "custom",
        detail: "refined",
        parts: [
          {
            shape: "box",
            position: [0, 0, 0],
            scale: [2, 2, 2],
            rotation: [0, 0, 0],
            color: "#ffffff",
          },
        ],
      },
    });
  return {
    version: 1,
    id: "webgl-visibility",
    title: "Visibility fixture",
    seed: 1,
    revision: 4,
    entities: [
      entity("north", [999_900, 0, -999_930]),
      entity("west", [999_870, 0, -999_900]),
      entity("behind", [999_900, 0, -999_870]),
    ],
    environment: { sky: "#ffffff", ground: "#ffffff", water: "#ffffff" },
    messages: [],
  };
}

describe("WebGL navigation visibility adapter", () => {
  it("culls against the shared pose at far coordinates and follows heading", () => {
    const project = projectAtFarWorld();
    const bounds = worldNavigationBoundsByEntity(project);
    const state = (heading: number): WorldNavigationState =>
      createWorldNavigationState({
        target: [999_900, 0, -999_900],
        heading,
        distance: 24,
      });

    expect([
      ...visibleWebGLNavigationEntityIds(project, bounds, state(0), 390, 844),
    ]).toEqual(["north"]);
    expect([
      ...visibleWebGLNavigationEntityIds(
        project,
        bounds,
        state(Math.PI / 2),
        390,
        844,
      ),
    ]).toEqual(["west"]);
  });

  it("keeps entities with pending or invalid bounds visible", () => {
    const project = projectAtFarWorld();
    const bounds: WorldNavigationEntityBounds = new Map([
      ["north", undefined],
      ["west", { min: [2, 0, 0], max: [-2, 1, 1] } as WorldNavigationBounds],
      ["behind", worldNavigationBoundsByEntity(project).get("behind")],
    ]);
    const visible = visibleWebGLNavigationEntityIds(
      project,
      bounds,
      createWorldNavigationState({
        target: [999_900, 0, -999_900],
        distance: 24,
      }),
      390,
      844,
    );

    expect(visible.has("north")).toBe(true);
    expect(visible.has("west")).toBe(true);
    expect(visible.has("behind")).toBe(false);
  });

  it("returns all entities for a degenerate viewport", () => {
    const project = projectAtFarWorld();
    expect([
      ...visibleWebGLNavigationEntityIds(
        project,
        new Map<string, WorldNavigationBounds | undefined>(),
        createWorldNavigationState(),
        0,
        844,
      ),
    ]).toEqual(project.entities.map(({ id }) => id));
  });
});
