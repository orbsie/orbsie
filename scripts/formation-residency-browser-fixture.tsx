import * as THREE from "three";
import { createRoot } from "react-dom/client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import World, {
  visibleWebGLNavigationEntityIds,
} from "../src/components/world";
import SoftwareWorld, {
  softwareProxyBoundsByEntity,
} from "../src/components/software-world";
import { useOrb } from "../src/lib/store";
import { blankProject, type Entity } from "../src/lib/protocol";
import { formationRecipeIdentity } from "../src/lib/formation-completion";
import {
  committedWorldNavigationBounds,
  worldNavigationBoundsByEntity,
} from "../src/lib/world-navigation-bounds";
import {
  applyWorldNavigationCommand,
  createWorldNavigationState,
} from "../src/lib/world-navigation";
import { selectFormationResidencyPresentation } from "../src/lib/formation-residency-presentation";
import { selectSoftwareFormationResidency } from "../src/lib/software-formation-residency";
import { WorldNavigationGestureController } from "../src/lib/world-navigation-gestures";
import { _roots } from "@react-three/fiber";

const COLUMN_COUNT = 10;
const ROW_COUNT = 5;
const LOCAL_SPACING = 0.72;
const CLUSTER_CENTERS = { home: -600, distant: 600 } as const;
const LOCAL_Z_CENTER = -4;

function colorFor(index: number): string {
  const red = ((55 + index * 73) % 220) + 24;
  const green = ((90 + index * 47) % 190) + 35;
  const blue = ((130 + index * 61) % 175) + 55;
  return `#${[red, green, blue]
    .map((component) => component.toString(16).padStart(2, "0"))
    .join("")}`;
}

function makeEntity(
  id: string,
  index: number,
  position: readonly [number, number, number],
): Entity {
  const color = colorFor(index);
  return {
    id,
    label: id,
    position: [...position],
    scale: [1, 1, 1],
    color,
    stage: "ready",
    behavior: { type: "static" },
    geometry: {
      kind: "custom",
      detail: "coarse",
      parts: [
        {
          shape: "box",
          position: [0, 0.45, 0],
          scale: [0.48, 0.48, 0.48],
          color,
        },
      ],
    },
  };
}

function visibleCluster(prefix: string, centerX: number, indexOffset: number) {
  return Array.from({ length: COLUMN_COUNT * ROW_COUNT }, (_, index) => {
    const column = index % COLUMN_COUNT;
    const row = Math.floor(index / COLUMN_COUNT);
    return makeEntity(
      `${prefix}-visible-${String(index).padStart(2, "0")}`,
      indexOffset + index,
      [
        centerX + (column - (COLUMN_COUNT - 1) / 2) * LOCAL_SPACING,
        0,
        LOCAL_Z_CENTER + (row - (ROW_COUNT - 1) / 2) * LOCAL_SPACING,
      ],
    );
  });
}

function nearbyCluster(prefix: string, centerX: number, indexOffset: number) {
  return Array.from({ length: 10 }, (_, index) =>
    makeEntity(
      `${prefix}-near-${String(index).padStart(2, "0")}`,
      indexOffset + index,
      [centerX + 180, 0, LOCAL_Z_CENTER + (index - 4.5) * 0.9],
    ),
  );
}

const entities = [
  ...visibleCluster("home", CLUSTER_CENTERS.home, 0),
  ...nearbyCluster("home", CLUSTER_CENTERS.home, 50),
  ...visibleCluster("distant", CLUSTER_CENTERS.distant, 60),
  ...nearbyCluster("distant", CLUSTER_CENTERS.distant, 110),
];
const fixtureProject = {
  ...blankProject(),
  title: "Formation residency browser fixture",
  entities,
};
const entityById = new Map(entities.map((entity) => [entity.id, entity]));
const worldBounds = worldNavigationBoundsByEntity(fixtureProject);
const softwareBounds = softwareProxyBoundsByEntity(fixtureProject);
const recipes = new Map(
  entities.map((entity) => [entity.id, formationRecipeIdentity(entity)]),
);

const paintProbe = {
  frames: 0,
  currentProxyRadii: [] as number[],
  reset() {
    this.frames = 0;
    this.currentProxyRadii = [];
  },
  snapshot() {
    return {
      frames: this.frames,
      proxyArcCount: this.currentProxyRadii.length,
      proxyArcRadii: [...this.currentProxyRadii],
    };
  },
};
(window as any).__formationResidencyPaintProbe = paintProbe;
const contextPrototype = window.CanvasRenderingContext2D?.prototype;
if (contextPrototype) {
  const clearRect = contextPrototype.clearRect;
  const arc = contextPrototype.arc;
  contextPrototype.clearRect = function (
    ...args: Parameters<typeof clearRect>
  ) {
    if ((this as CanvasRenderingContext2D).canvas.closest(".software-world")) {
      paintProbe.frames += 1;
      paintProbe.currentProxyRadii = [];
    }
    return clearRect.apply(this, args);
  };
  contextPrototype.arc = function (...args: Parameters<typeof arc>) {
    if (
      (this as CanvasRenderingContext2D).canvas.closest(".software-world") &&
      args[2] >= 5.5 &&
      args[2] <= 22.5
    )
      paintProbe.currentProxyRadii.push(args[2]);
    return arc.apply(this, args);
  };
}

function visibleIdsAt(targetX: number, width: number, height: number) {
  const navigation = createWorldNavigationState({
    target: [targetX, 0, 0],
    distance: 100,
  });
  return visibleWebGLNavigationEntityIds(
    fixtureProject,
    worldBounds,
    navigation,
    width,
    height,
  );
}

function expectedResidency(
  targetX: number,
  selectedId: string,
  width: number,
  height: number,
) {
  const visibleIds = visibleIdsAt(targetX, width, height);
  const focus = [targetX, 0, 0] as const;
  const webgl = selectFormationResidencyPresentation({
    candidates: entities.map((entity) => ({
      id: entity.id,
      stage: entity.stage,
      recipeIdentity: recipes.get(entity.id)!,
      completedRecipeIdentity: recipes.get(entity.id)!,
      worldCenter: softwareBounds.get(entity.id)?.center,
    })),
    focus,
    visibleIds,
    selectedId,
    enabled: true,
  });
  const software = selectSoftwareFormationResidency({
    entities,
    completedRecipeByEntity: recipes,
    proxyBoundsByEntity: softwareBounds,
    focus,
    visibleIds,
    selectedId,
    enabled: true,
  });
  return {
    readyCount: entities.filter((entity) => entity.stage === "ready").length,
    visibleCount: visibleIds.size,
    visibleMainCount: [...visibleIds].filter((id) => id.includes("-visible-"))
      .length,
    residentCount: webgl.residentIds.size,
    selectedReason: webgl.selection.reasonById.get(selectedId),
    webglResidentIds: [...webgl.residentIds].sort(),
    webglPlaceholderIds: [...webgl.proxyIds].sort(),
    softwareResidentIds: [...software.residentIds].sort(),
    softwareProxyIds: [...software.proxyIds].sort(),
    nearbyReasons: entities
      .filter((entity) => entity.id.includes("-near-"))
      .map((entity) => [entity.id, webgl.selection.reasonById.get(entity.id)]),
  };
}

function cloneNavigation(value: ReturnType<typeof createWorldNavigationState>) {
  return { ...value, target: [...value.target] as [number, number, number] };
}

function mapScenePosition(position: THREE.Vector3) {
  let nearest: Entity | undefined;
  let best = Number.POSITIVE_INFINITY;
  for (const entity of entities) {
    const distance = Math.hypot(
      position.x - entity.position[0],
      position.z - entity.position[2],
    );
    if (distance < best) {
      nearest = entity;
      best = distance;
    }
  }
  return best <= 0.02 ? nearest?.id : undefined;
}

function readWebGLScene() {
  const canvas = document.querySelector("canvas");
  const root = canvas ? _roots.get(canvas) : undefined;
  const renderer = (window as any).__formationResidencyRenderer;
  if (!canvas || !root)
    return {
      available: false,
      renderer: renderer ?? "software-fallback-or-not-ready",
      projectEntityCount: useOrb.getState().project.entities.length,
    };
  const state = root.store.getState();
  const fullIds = new Set<string>();
  const proxyIds = new Set<string>();
  const selectedFullIds = new Set<string>();
  let formationMeshCount = 0;
  let particleMeshCount = 0;
  let fullGroupCount = 0;
  let proxyGroupCount = 0;
  let selectedFullRingCount = 0;
  state.scene.traverse((object: any) => {
    if (!object.isGroup || object.userData.orbsieNavigationHit !== true) return;
    let hasFormation = false;
    let hasSelectionRing = false;
    object.traverse((child: any) => {
      if (child.isMesh && child.geometry?.type === "RingGeometry")
        hasSelectionRing = true;
      if (
        child.isMesh &&
        child.material?.customProgramCacheKey?.() === "orbsie-formation-v3"
      ) {
        hasFormation = true;
        formationMeshCount += 1;
      }
      if (
        child.isPoints &&
        child.material?.customProgramCacheKey?.() ===
          "orbsie-formation-particles-v1"
      )
        particleMeshCount += 1;
    });
    const id = mapScenePosition(object.position);
    if (hasFormation) {
      fullGroupCount += 1;
      if (id) fullIds.add(id);
      if (hasSelectionRing) {
        selectedFullRingCount += 1;
        if (id) selectedFullIds.add(id);
      }
    } else {
      proxyGroupCount += 1;
      if (id) proxyIds.add(id);
    }
  });
  const context = state.gl.getContext();
  const extension = context.getExtension("WEBGL_debug_renderer_info");
  const debugRenderer = extension
    ? context.getParameter(extension.UNMASKED_RENDERER_WEBGL)
    : "unavailable";
  return {
    available: true,
    renderer: renderer ?? "webgl",
    contextVersion: context.getParameter(context.VERSION),
    debugRenderer,
    projectEntityCount: useOrb.getState().project.entities.length,
    selectedId: useOrb.getState().selected,
    fullFormationCount: fullGroupCount,
    fullIds: [...fullIds].sort(),
    selectedFullIds: [...selectedFullIds].sort(),
    selectedFullRingCount,
    proxyGroupCount,
    proxyIds: [...proxyIds].sort(),
    formationMeshCount,
    particleMeshCount,
    resources: {
      geometries: state.gl.info.memory.geometries,
      textures: state.gl.info.memory.textures,
      programs: state.gl.info.programs?.length ?? 0,
    },
    canvas: { width: canvas.width, height: canvas.height },
  };
}

function installWebGLFixture() {
  let predictedNavigation = createWorldNavigationState();
  const fixture = {
    ready() {
      const sample = readWebGLScene();
      const navButton = document.querySelector<HTMLButtonElement>(
        'button[aria-label="Frame content"]',
      );
      return (
        sample.available &&
        navButton !== null &&
        !navButton.disabled &&
        sample.projectEntityCount === 120
      );
    },
    renderer: readWebGLScene,
    expectedAt(targetX: number, selectedId: string) {
      return expectedResidency(
        targetX,
        selectedId,
        window.innerWidth,
        window.innerHeight,
      );
    },
    select(id: string) {
      if (!entityById.has(id)) throw Error(`Unknown fixture entity: ${id}`);
      useOrb.getState().set({ selected: id });
    },
    afterFrameContent() {
      predictedNavigation = applyWorldNavigationCommand(predictedNavigation, {
        type: "frame_content",
        committedEntityBounds: committedWorldNavigationBounds(fixtureProject),
        viewportAspect: window.innerWidth / Math.max(1, window.innerHeight),
        verticalFovRadians: (43 * Math.PI) / 180,
      });
      return cloneNavigation(predictedNavigation);
    },
    zoomInSteps(targetDistance = 100) {
      const steps = Math.max(
        0,
        Math.ceil(
          Math.log(targetDistance / predictedNavigation.distance) /
            Math.log(0.8),
        ),
      );
      for (let step = 0; step < steps; step++)
        predictedNavigation = applyWorldNavigationCommand(predictedNavigation, {
          type: "zoom",
          factor: 0.8,
        });
      return steps;
    },
    panPlanTo(targetX: number) {
      const canvas = document.querySelector("canvas");
      if (!canvas) throw Error("WebGL world canvas is missing.");
      const rect = canvas.getBoundingClientRect();
      const metersPerPixel =
        (2 * predictedNavigation.distance * Math.tan((43 * Math.PI) / 360)) /
        Math.max(1, rect.height);
      const dx = (predictedNavigation.target[0] - targetX) / metersPerPixel;
      const startX = dx < 0 ? rect.width / 2 : 20;
      const startY = rect.height / 2;
      const endX = startX + dx;
      if (endX < 4 || endX > rect.width - 4)
        throw Error(`Predicted pan exceeds viewport (${startX} to ${endX}).`);
      const controller = new WorldNavigationGestureController();
      controller.pointerDown({
        pointerId: 901,
        pointerType: "mouse",
        x: startX,
        y: startY,
        button: "primary",
        objectHit: false,
      });
      const movement = controller.pointerMove(
        { pointerId: 901, x: endX, y: startY },
        {
          width: rect.width,
          height: rect.height,
          verticalFovRadians: (43 * Math.PI) / 180,
          distance: predictedNavigation.distance,
          heading: predictedNavigation.heading,
        },
      );
      const command = movement.commands.find((item) => item.type === "pan");
      if (!command || command.type !== "pan")
        throw Error("Could not calculate a navigation pan gesture.");
      predictedNavigation = applyWorldNavigationCommand(
        predictedNavigation,
        command,
      );
      return {
        start: { x: rect.left + startX, y: rect.top + startY },
        end: { x: rect.left + endX, y: rect.top + startY },
        expectedNavigation: cloneNavigation(predictedNavigation),
      };
    },
  };
  (window as any).formationResidencyFixture = fixture;
}

function SoftwareFixtureHost() {
  const [navigation, setNavigation] = useState(() =>
    createWorldNavigationState({
      target: [CLUSTER_CENTERS.home, 0, 0],
      distance: 100,
    }),
  );
  const navigationRef = useRef(navigation);
  navigationRef.current = navigation;
  const controller = useMemo(() => new WorldNavigationGestureController(), []);
  const dispatchNavigation = useCallback(
    (command: Parameters<typeof applyWorldNavigationCommand>[1]) =>
      setNavigation((current) => applyWorldNavigationCommand(current, command)),
    [],
  );
  const getNavigation = useCallback(() => navigationRef.current, []);
  useEffect(() => {
    (window as any).formationResidencyFixture = {
      ready() {
        const source = (window as any).__orbsieSceneReviewFixture?.software;
        if (!source) return false;
        const state = source.read();
        return (
          state.mounted &&
          state.transitionSettled &&
          state.renderedRevision === fixtureProject.revision
        );
      },
      renderer() {
        const source = (window as any).__orbsieSceneReviewFixture?.software;
        return source?.read() ?? null;
      },
      focus(targetX: number) {
        const current = navigationRef.current;
        dispatchNavigation({
          type: "pan",
          delta: [targetX - current.target[0], 0],
        });
      },
      select(id: string) {
        if (!entityById.has(id)) throw Error(`Unknown fixture entity: ${id}`);
        useOrb.getState().set({ selected: id });
      },
      expectedAt(targetX: number, selectedId: string) {
        return expectedResidency(
          targetX,
          selectedId,
          window.innerWidth,
          window.innerHeight,
        );
      },
      paint: () => paintProbe.snapshot(),
      resetPaint: () => paintProbe.reset(),
      navigation: () => cloneNavigation(navigationRef.current),
    };
  }, [dispatchNavigation]);
  return (
    <div className="software-fixture">
      <SoftwareWorld
        navigation={navigation}
        getNavigation={getNavigation}
        navigationGestureController={controller}
        navigationEnabled
        onNavigationCommand={dispatchNavigation}
        onNavigationClickSuppression={() => {}}
        clearNavigationGestures={() => controller.reset()}
        clearNavigationClickFallback={() => {}}
        consumeNavigationClick={() => false}
        onRendererReady={() => {
          (window as any).__formationResidencyRenderer = "software";
        }}
      />
    </div>
  );
}

async function boot() {
  (window as any).__formationResidencyRenderer = "booting";
  (window as any).__orbsieSceneReviewFixture = {};
  const loaded = await useOrb.getState().load(fixtureProject, false);
  if (!loaded) throw Error("Could not load the deterministic fixture project.");
  const software =
    new URLSearchParams(location.search).get("renderer") === "software";
  if (software)
    createRoot(document.getElementById("root")!).render(
      <SoftwareFixtureHost />,
    );
  else {
    installWebGLFixture();
    createRoot(document.getElementById("root")!).render(
      <World
        onRendererReady={(renderer) => {
          (window as any).__formationResidencyRenderer = renderer ?? "webgl";
        }}
        onRendererFallback={() => {
          (window as any).__formationResidencyRenderer = "software-fallback";
        }}
        onError={(message) => {
          (window as any).__formationResidencyError = message;
        }}
      />,
    );
  }
}

void boot().catch((error) => {
  (window as any).__formationResidencyBootError =
    error instanceof Error ? error.message : String(error);
});
