import {
  beginExperience,
  getExperienceMetrics,
  noteReservation,
  noteSceneUpdate,
} from "../src/lib/experience-metrics";
import * as THREE from "three";
import { createRoot } from "react-dom/client";
import { _roots } from "@react-three/fiber";
import World from "../src/components/world";
import { useOrb } from "../src/lib/store";
import { blankProject, type Entity } from "../src/lib/protocol";
import { isAssetGeometryReady } from "../src/lib/use-asset-geometry";

/** Test-only fixture for a local procedural/catalog renderer comparison. */
export type ComparisonMode = "procedural-only" | "catalog-only" | "mixed";

const catalogId = "kenney.nature.tree-default" as const;
const projectId = "catalog-comparison";
const positions: [number, number, number][] = [
  [-3, 0, 0],
  [0, 0, 0],
  [3, 0, 0],
];
const color = "#42b894";
const mode = (() => {
  const value = new URLSearchParams(location.search).get("mode");
  if (value === "catalog-only" || value === "mixed") return value;
  return "procedural-only";
})();

function geometryFor(index: number): Entity["geometry"] {
  if (mode === "catalog-only" || (mode === "mixed" && index === 2))
    return { kind: "asset", assetId: catalogId, detail: "refined" };
  return { kind: "tree", detail: "refined" };
}

const state = () => {
  const canvas = document.querySelector("canvas");
  if (!canvas) return undefined;
  return _roots.get(canvas)?.store.getState();
};
async function waitForRendererFrame() {
  const started = performance.now();
  while (performance.now() - started < 10_000) {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
    if ((state()?.gl.info.render.frame ?? 0) > 0) return;
  }
  throw Error("Blank World renderer did not produce an initial frame.");
}

// Load a stable blank project first, then seed the exact entity objects that
// will be passed to React. This keeps the metric WeakMap keys aligned with the
// Formation objects rendered by World.
const blank = blankProject();
blank.id = projectId;
blank.seed = 42;
blank.environment = { sky: "#dceee9", ground: "#91b977", water: "#59bdbb" };
useOrb.getState().load(blank);
const root = createRoot(document.getElementById("root")!);
root.render(<World />);
await waitForRendererFrame();
const loaded = useOrb.getState().project;
const entities: Entity[] = positions.map((position, index) => ({
  id: `tree-${index + 1}`,
  label: `Tree ${index + 1}`,
  position,
  scale: [1, 1, 1],
  color,
  stage: "ready",
  behavior: { type: "static" },
  geometry: geometryFor(index),
  assetPolicy: "catalog-allowed",
}));
const project = { ...loaded, entities };
const experienceToken = beginExperience(project.id);
for (const entity of entities) {
  noteReservation(project.id, entity.id, experienceToken);
  noteSceneUpdate(project.id, entity, experienceToken);
}
useOrb.setState({
  project,
  phase: "editing",
  playing: false,
  building: false,
  selected: undefined,
  error: "",
});

const frameIntervals: number[] = [];
let frameIntervalOverflow = false;
let previousFrame: number | undefined;
let preparationReadyAt: number | null = null;
const assetEntities = entities.filter(
  (entity) => entity.geometry?.kind === "asset",
);
const metrics = () => getExperienceMetrics(project.id)[0];
const assetsReady = () =>
  assetEntities.every(
    (entity) =>
      entity.geometry?.kind !== "asset" ||
      isAssetGeometryReady(entity.geometry.assetId),
  );
const allEntitiesDrawn = () =>
  metrics()?.sceneUpdates.length === entities.length &&
  metrics()?.sceneUpdates.every((sample) => sample.drawnAt !== null);
function sampleFrame(now: number) {
  if (previousFrame !== undefined) {
    if (frameIntervals.length < 120) frameIntervals.push(now - previousFrame);
    else frameIntervalOverflow = true;
  }
  previousFrame = now;
  if (preparationReadyAt === null && assetsReady() && allEntitiesDrawn())
    preparationReadyAt = now;
  if (preparationReadyAt === null) requestAnimationFrame(sampleFrame);
}

const rendererDetails = () => {
  const renderer = state()?.gl;
  const context = renderer?.getContext();
  if (!renderer || !context)
    return { renderer: "unavailable", webglVersion: "unavailable" };
  const debug = context.getExtension("WEBGL_debug_renderer_info") as {
    UNMASKED_RENDERER_WEBGL: number;
    UNMASKED_VENDOR_WEBGL: number;
  } | null;
  return {
    renderer: debug
      ? context.getParameter(debug.UNMASKED_RENDERER_WEBGL)
      : context.getParameter(context.RENDERER),
    vendor: debug
      ? context.getParameter(debug.UNMASKED_VENDOR_WEBGL)
      : context.getParameter(context.VENDOR),
    webglVersion: context.getParameter(context.VERSION),
    shadingLanguageVersion: context.getParameter(
      context.SHADING_LANGUAGE_VERSION,
    ),
  };
};
const sceneComplexity = () => {
  const current = state();
  const counts = {
    meshGeometryCount: 0,
    pointGeometryCount: 0,
    triangleCount: 0,
    vertexCount: 0,
  };
  current?.scene.traverse((object: THREE.Object3D) => {
    const renderable = object as THREE.Mesh | THREE.Points;
    const flags = renderable as unknown as {
      isMesh?: boolean;
      isPoints?: boolean;
    };
    if (!flags.isMesh && !flags.isPoints) return;
    if (flags.isMesh) counts.meshGeometryCount++;
    if (flags.isPoints) counts.pointGeometryCount++;
    const geometry = renderable.geometry;
    const position = geometry?.getAttribute("position");
    if (!position) return;
    counts.vertexCount += position.count;
    counts.triangleCount += geometry.index
      ? geometry.index.count / 3
      : flags.isMesh
        ? position.count / 3
        : 0;
  });
  return {
    scope:
      "scene geometry inventory, including hidden formation/debug geometry",
    entities: entities.length,
    geometrySources: entities.map((entity) => entity.geometry?.kind),
    catalogAssetEntities: assetEntities.length,
    ...counts,
  };
};

(
  window as unknown as {
    catalogComparisonFixture: {
      mode: ComparisonMode;
      ready: () => boolean;
      status: () => unknown;
    };
  }
).catalogComparisonFixture = {
  mode,
  ready: () =>
    !!state() &&
    assetsReady() &&
    allEntitiesDrawn() &&
    preparationReadyAt !== null,
  status: () => {
    const snapshot = metrics();
    return {
      mode,
      project: {
        id: project.id,
        seed: project.seed,
        environment: project.environment,
      },
      metrics: snapshot,
      assetsReady: assetsReady(),
      preparationReadyAt,
      frameIntervals: [...frameIntervals],
      frameIntervalOverflow,
      renderer: rendererDetails(),
      browser: {
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        hardwareConcurrency: navigator.hardwareConcurrency,
        devicePixelRatio: window.devicePixelRatio,
        viewport: { width: innerWidth, height: innerHeight },
      },
      sceneComplexity: sceneComplexity(),
    };
  },
};
previousFrame = performance.now();
requestAnimationFrame(sampleFrame);
