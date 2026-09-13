import {
  beginExperience,
  getExperienceMetrics,
  noteReservation,
  noteSceneUpdate,
} from "../src/lib/experience-metrics";
import * as THREE from "three";
import React from "react";
import { createRoot } from "react-dom/client";
import { _roots } from "@react-three/fiber";
import World from "../src/components/world";
import { useOrb } from "../src/lib/store";
import { blankProject, type Entity } from "../src/lib/protocol";
import { isAssetGeometryReady } from "../src/lib/use-asset-geometry";
import { exportWorld } from "../src/lib/export";

/** Test-only fixture for a local procedural/catalog renderer comparison. */
export type ComparisonMode =
  | "procedural-only"
  | "catalog-only"
  | "mixed"
  | "textured"
  | "software-textured";

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
  if (
    value === "catalog-only" ||
    value === "mixed" ||
    value === "textured" ||
    value === "software-textured"
  )
    return value;
  return "procedural-only";
})();

function geometryFor(index: number): Entity["geometry"] {
  if (
    mode === "catalog-only" ||
    mode === "textured" ||
    mode === "software-textured" ||
    (mode === "mixed" && index === 2)
  )
    return { kind: "asset", assetId: catalogId, detail: "refined" };
  return { kind: "tree", detail: "refined" };
}

const state = () => {
  const canvas = document.querySelector("canvas");
  if (!canvas) return undefined;
  return _roots.get(canvas)?.store.getState();
};
const softwareMode = mode === "software-textured";
async function waitForRendererFrame() {
  const started = performance.now();
  while (performance.now() - started < 10_000) {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
    if ((state()?.gl.info.render.frame ?? 0) > 0) return;
    if (
      softwareMode &&
      document.querySelector(".software-world-status") &&
      (document.querySelector(".software-world canvas") as HTMLCanvasElement)
        ?.width > 0
    )
      return;
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
if (softwareMode)
  (
    globalThis as typeof globalThis & {
      __orbsieSoftwareWorldProbe?: { read?: () => unknown };
    }
  ).__orbsieSoftwareWorldProbe = {};
const root = createRoot(document.getElementById("root")!);
root.render(
  <React.StrictMode>
    <World />
  </React.StrictMode>,
);
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
let project = { ...loaded, entities };
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
  softwareMode
    ? !!document.querySelector(".software-world canvas")
    : metrics()?.sceneUpdates.length === entities.length &&
      metrics()?.sceneUpdates.every((sample) => sample.drawnAt !== null);
let disposedTextureCount = 0;
const watchedTextures = new WeakSet<THREE.DataTexture>();
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
  if (softwareMode)
    return {
      renderer: "software-canvas",
      webglVersion: "forced-unavailable",
    };
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
const appearanceDetails = () => {
  if (softwareMode) {
    const meshes = (
      globalThis as typeof globalThis & {
        __orbsieSoftwareWorldProbe?: { read?: () => unknown };
      }
    ).__orbsieSoftwareWorldProbe?.read?.() as
      Array<Record<string, unknown>> | undefined;
    return {
      dataTextureMaps: 0,
      pinkVertexColorMeshes: 0,
      meshes: Array.isArray(meshes)
        ? meshes.map((mesh) => ({
            ...mesh,
            visible: true,
            assetId: "software-baked",
            map: null,
            vertexColor: {
              average: [0, 0, 0],
              range: (mesh.colorRange as number[] | undefined) ?? [0, 0, 0],
              uniform: false,
            },
          }))
        : [],
    };
  }
  const current = state();
  const details: {
    dataTextureMaps: number;
    pinkVertexColorMeshes: number;
    meshes: Array<{
      position: [number, number, number];
      assetId?: unknown;
      visible: boolean;
      map: null | {
        uuid: string;
        width: number;
        height: number;
        pixelBytes: number;
        dataIdentity: number;
      };
      vertexColor: null | {
        average: [number, number, number];
        range: [number, number, number];
        uniform: boolean;
      };
    }>;
  } = { dataTextureMaps: 0, pinkVertexColorMeshes: 0, meshes: [] };
  const textureData = new Map<unknown, number>();
  current?.scene.traverse((object: THREE.Object3D) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materials: THREE.Material[] = Array.isArray(mesh.material)
      ? mesh.material
      : mesh.material
        ? [mesh.material]
        : [];
    const map = materials
      .map((material) => ("map" in material ? material.map : null))
      .find(
        (value): value is THREE.DataTexture =>
          value instanceof THREE.DataTexture,
      );
    if (map) {
      details.dataTextureMaps++;
      if (!watchedTextures.has(map)) {
        watchedTextures.add(map);
        map.addEventListener("dispose", () => disposedTextureCount++);
      }
    }
    const color = mesh.geometry?.getAttribute("color");
    let vertexColor: (typeof details.meshes)[number]["vertexColor"] = null;
    if (color && color.count > 0) {
      const min = [
        Number.POSITIVE_INFINITY,
        Number.POSITIVE_INFINITY,
        Number.POSITIVE_INFINITY,
      ];
      const max = [
        Number.NEGATIVE_INFINITY,
        Number.NEGATIVE_INFINITY,
        Number.NEGATIVE_INFINITY,
      ];
      const average = [0, 0, 0];
      for (let index = 0; index < color.count; index++) {
        const values = [
          color.getX(index),
          color.getY(index),
          color.getZ(index),
        ];
        for (let channel = 0; channel < 3; channel++) {
          min[channel] = Math.min(min[channel], values[channel]);
          max[channel] = Math.max(max[channel], values[channel]);
          average[channel] += values[channel] / color.count;
        }
      }
      const range = max.map((value, channel) => value - min[channel]);
      const uniform = range.every((value) => value <= 1e-4);
      vertexColor = {
        average: average as [number, number, number],
        range: range as [number, number, number],
        uniform,
      };
      if (
        uniform &&
        average[0] > 0.9 &&
        average[1] < 0.25 &&
        average[2] > 0.2 &&
        average[2] < 0.65
      )
        details.pinkVertexColorMeshes++;
    }
    const position = new THREE.Vector3();
    mesh.getWorldPosition(position);
    const dataIdentity = map
      ? (() => {
          const data = map.image.data;
          const existing = textureData.get(data);
          if (existing !== undefined) return existing;
          const next = textureData.size + 1;
          textureData.set(data, next);
          return next;
        })()
      : 0;
    details.meshes.push({
      position: [position.x, position.y, position.z],
      assetId: mesh.geometry?.userData?.orbsieAssetId,
      visible: mesh.visible,
      map: map
        ? {
            uuid: map.uuid,
            width: map.image.width,
            height: map.image.height,
            pixelBytes: map.image.data?.byteLength ?? 0,
            dataIdentity,
          }
        : null,
      vertexColor,
    });
  });
  return details;
};

const setTint = (tint: string | undefined) => {
  const current = useOrb.getState().project;
  const entities = current.entities.map((entity) => {
    if (entity.id !== "tree-1" || entity.geometry?.kind !== "asset")
      return entity;
    const { tint: _previous, ...geometry } = entity.geometry;
    return {
      ...entity,
      geometry: tint ? { ...geometry, tint } : geometry,
    };
  });
  project = { ...current, entities };
  useOrb.setState({ project });
};

const replacementAssetIds = {
  pending: "kenney.nature.tree-pine-tall-a",
  failed: "kenney.nature.fence-gate",
} as const;
const replaceAsset = (
  replacement: keyof typeof replacementAssetIds | "restore",
) => {
  const current = useOrb.getState().project;
  const assetId =
    replacement === "restore" ? catalogId : replacementAssetIds[replacement];
  const entities = current.entities.map((entity) =>
    entity.id === "tree-1"
      ? {
          ...entity,
          geometry: {
            kind: "asset" as const,
            assetId,
            detail: "refined" as const,
          },
        }
      : entity,
  );
  project = { ...current, entities };
  useOrb.setState({ project });
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
    (softwareMode
      ? !!document.querySelector(".software-world canvas")
      : !!state()) &&
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
      disposedTextureCount,
      preparationReadyAt,
      frameIntervals: [...frameIntervals],
      frameIntervalOverflow,
      renderer: rendererDetails(),
      appearance: appearanceDetails(),
      error: useOrb.getState().error,
      entityGeometry: useOrb.getState().project.entities.map((entity) => ({
        id: entity.id,
        kind: entity.geometry?.kind,
        assetId:
          entity.geometry?.kind === "asset"
            ? entity.geometry.assetId
            : undefined,
      })),
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

(
  window as unknown as {
    catalogComparisonFixture: {
      setTint: (tint?: string) => void;
      replaceAsset: (
        replacement: keyof typeof replacementAssetIds | "restore",
      ) => void;
      cleanup: () => void;
      renderDirection: (rear?: boolean) => void;
      exportWorld: () => Promise<void>;
    };
  }
).catalogComparisonFixture.setTint = setTint;
(
  window as unknown as {
    catalogComparisonFixture: {
      replaceAsset: (
        replacement: keyof typeof replacementAssetIds | "restore",
      ) => void;
    };
  }
).catalogComparisonFixture.replaceAsset = replaceAsset;
(
  window as unknown as { catalogComparisonFixture: { cleanup: () => void } }
).catalogComparisonFixture.cleanup = () => root.unmount();
(
  window as unknown as {
    catalogComparisonFixture: {
      renderDirection: (rear?: boolean) => void;
    };
  }
).catalogComparisonFixture.renderDirection = (rear = false) => {
  const current = state();
  if (!current) return;
  const camera = current.camera;
  camera.position.set(rear ? -5 : 5, 2.7, rear ? -5 : 5);
  camera.lookAt(0, 0.5, 0);
  camera.updateMatrixWorld(true);
  current.gl.render(current.scene, camera);
};
(
  window as unknown as {
    catalogComparisonFixture: { exportWorld: () => Promise<void> };
  }
).catalogComparisonFixture.exportWorld = () =>
  exportWorld(useOrb.getState().project);
previousFrame = performance.now();
requestAnimationFrame(sampleFrame);
