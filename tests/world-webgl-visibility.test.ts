import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  entitySchema,
  MAX_SCENE_POSITION,
  type Project,
} from "../src/lib/protocol";
import {
  worldNavigationBoundsByEntity,
  type WorldNavigationEntityBounds,
} from "../src/lib/world-navigation-bounds";
import {
  createWorldNavigationState,
  type WorldNavigationBounds,
  type WorldNavigationState,
  worldNavigationCameraPose,
} from "../src/lib/world-navigation";
import { GameSession } from "../src/lib/game-session";
import {
  visibleWebGLNavigationEntityIds,
  webGLGeometryVisibleInFrustum,
} from "../src/components/world";
import {
  selectRenderOrigin,
  worldCameraPoseToRenderLocal,
} from "../src/lib/render-origin";
import {
  resolveRuntimeScene,
  runtimeEntityMatrix,
} from "../src/lib/scene-runtime";

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

  it("classifies current geometry bounds against the active near and far planes", () => {
    const camera = new THREE.PerspectiveCamera(43, 1, 0.1, 250);
    camera.position.set(0, 0, 12);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    const frustum = new THREE.Frustum().setFromProjectionMatrix(
      new THREE.Matrix4().multiplyMatrices(
        camera.projectionMatrix,
        camera.matrixWorldInverse,
      ),
    );
    const geometry = new THREE.BoxGeometry(2, 2, 2);

    expect(
      webGLGeometryVisibleInFrustum(
        geometry,
        new THREE.Matrix4().makeTranslation(0, 0, 0),
        frustum,
      ),
    ).toBe(true);
    expect(
      webGLGeometryVisibleInFrustum(
        geometry,
        new THREE.Matrix4().makeTranslation(10_000, 0, 0),
        frustum,
      ),
    ).toBe(false);
    expect(
      webGLGeometryVisibleInFrustum(
        geometry,
        new THREE.Matrix4().makeTranslation(0, 0, 20),
        frustum,
      ),
    ).toBe(false);
    const beforeNearPlane = new THREE.BoxGeometry(0.05, 0.05, 0.05);
    expect(
      webGLGeometryVisibleInFrustum(
        beforeNearPlane,
        new THREE.Matrix4().makeTranslation(0, 0, 12),
        frustum,
      ),
    ).toBe(false);
    expect(
      webGLGeometryVisibleInFrustum(
        new THREE.BufferGeometry(),
        new THREE.Matrix4().makeTranslation(10_000, 0, 0),
        frustum,
      ),
    ).toBe(true);
    geometry.dispose();
    beforeNearPlane.dispose();
  });

  it("reveals a game-program teleport in the same project revision", () => {
    const entity = entitySchema.parse({
      id: "teleported",
      label: "Teleported object",
      position: [10_000, 0, 0],
      rotation: [0, 0, 0],
      stage: "ready",
    });
    const project: Project = {
      version: 1,
      id: "webgl-gameplay-culling",
      title: "Gameplay culling fixture",
      seed: 1,
      revision: 7,
      entities: [entity],
      environment: { sky: "#ffffff", ground: "#ffffff", water: "#ffffff" },
      messages: [],
    };
    const session = new GameSession();
    session.sync(project.id, {
      variables: [],
      rules: [
        {
          id: "teleport-on-start",
          trigger: { type: "start" },
          conditions: [],
          actions: [
            {
              type: "set_position",
              entityId: entity.id,
              position: [0, 0, 0],
            },
          ],
        },
      ],
    });
    const camera = new THREE.PerspectiveCamera(43, 1, 0.1, 250);
    camera.position.set(0, 0, 12);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    const frustum = new THREE.Frustum().setFromProjectionMatrix(
      new THREE.Matrix4().multiplyMatrices(
        camera.projectionMatrix,
        camera.matrixWorldInverse,
      ),
    );
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const scene = resolveRuntimeScene(project);
    const before = runtimeEntityMatrix(scene, entity, 0);

    expect(webGLGeometryVisibleInFrustum(geometry, before, frustum)).toBe(
      false,
    );
    session.advance(0);
    const after = runtimeEntityMatrix(
      scene,
      entity,
      0,
      session.state?.entityOverrides[entity.id]?.position,
    );
    expect(webGLGeometryVisibleInFrustum(geometry, after, frustum)).toBe(true);
    expect(project.revision).toBe(7);
    expect(project.entities[0].position).toEqual([10_000, 0, 0]);
    geometry.dispose();
  });

  it("tests rebased mesh bounds in the renderer-local camera frame", () => {
    const focus: [number, number, number] = [MAX_SCENE_POSITION - 8, 5, -30];
    const origin = selectRenderOrigin(focus);
    const worldPose = worldNavigationCameraPose(
      createWorldNavigationState({ target: focus, distance: 24 }),
    );
    const pose = worldCameraPoseToRenderLocal(worldPose, origin)!;
    const camera = new THREE.PerspectiveCamera(43, 1, 0.1, 500);
    camera.position.set(...pose.position);
    camera.lookAt(...pose.target);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    const frustum = new THREE.Frustum().setFromProjectionMatrix(
      new THREE.Matrix4().multiplyMatrices(
        camera.projectionMatrix,
        camera.matrixWorldInverse,
      ),
    );
    const workspaceFrame = new THREE.Group();
    workspaceFrame.position.set(-origin[0], -origin[1], -origin[2]);
    const entity = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    entity.position.set(...focus);
    workspaceFrame.add(entity);
    workspaceFrame.updateMatrixWorld(true);

    expect(entity.getWorldPosition(new THREE.Vector3()).length()).toBeLessThan(
      513,
    );
    expect(
      webGLGeometryVisibleInFrustum(
        entity.geometry,
        entity.matrixWorld,
        frustum,
      ),
    ).toBe(true);
    entity.geometry.dispose();
  });
});
