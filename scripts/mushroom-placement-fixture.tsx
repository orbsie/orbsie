import * as THREE from "three";
import { createRoot } from "react-dom/client";
import { _roots } from "@react-three/fiber";
import World from "../src/components/world";
import { useOrb } from "../src/lib/store";
import { blankProject, type Entity, type Project } from "../src/lib/protocol";
import { isAssetGeometryReady } from "../src/lib/use-asset-geometry";

/** Test-only fixture for comparing the saved and bounds-grounded mushroom poses. */
const assetId = "kenney.nature.mushroom-red" as const;
const projectId = "mushroom-placement-comparison";
const x = -5;
const z = -1.8;
const scale: [number, number, number] = [14, 14, 14];
const tint = "#ff69b4";
const entityGeometry: Entity["geometry"] = {
  kind: "asset",
  assetId,
  detail: "refined",
  tint,
};
const baseEntity: Entity = {
  id: "tree-1",
  label: "Giant Pink Mushroom",
  position: [x, 0, z],
  scale,
  color: tint,
  stage: "ready",
  behavior: { type: "static" },
  geometry: entityGeometry,
  assetPolicy: "catalog-allowed",
};

const state = () => {
  const canvas = document.querySelector("canvas");
  return canvas ? _roots.get(canvas)?.store.getState() : undefined;
};

function findMushroomMesh() {
  const scene = state()?.scene;
  let found: THREE.Mesh | undefined;
  scene?.traverse((object) => {
    if (
      !found &&
      (object as THREE.Mesh).isMesh &&
      (object as THREE.Mesh).geometry?.userData?.orbsieAssetId === assetId
    )
      found = object as THREE.Mesh;
  });
  return found;
}

function vector(vector: THREE.Vector3 | undefined) {
  return vector ? [vector.x, vector.y, vector.z] : null;
}

function bounds(box: THREE.Box3 | undefined) {
  return box ? { min: vector(box.min), max: vector(box.max) } : null;
}

function matrixValues(matrix: THREE.Matrix4 | undefined) {
  return matrix ? [...matrix.elements] : null;
}

function closeToIdentity(matrix: THREE.Matrix4 | undefined) {
  if (!matrix) return false;
  const identity = new THREE.Matrix4().elements;
  return matrix.elements.every(
    (value, index) => Math.abs(value - identity[index]) <= 1e-4,
  );
}

function rendererDetails() {
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
}

function status() {
  const current = useOrb
    .getState()
    .project.entities.find((candidate) => candidate.id === baseEntity.id);
  const mesh = findMushroomMesh();
  let localBox: THREE.Box3 | undefined;
  let worldBox: THREE.Box3 | undefined;
  let parentVisible = false;
  let particleBridge: unknown = undefined;
  let runtimeBox: THREE.Box3 | undefined;
  let island: THREE.Group | undefined;
  let positionCount = 0;
  let triangleCount = 0;
  if (mesh) {
    mesh.updateWorldMatrix(true, false);
    localBox = mesh.geometry.boundingBox ?? undefined;
    worldBox = new THREE.Box3().setFromObject(mesh);
    parentVisible = mesh.parent?.visible ?? false;
    island = mesh.parent?.parent as THREE.Group | undefined;
    island?.updateWorldMatrix(true, false);
    particleBridge = mesh.geometry.userData.particleBridge;
    const position = mesh.geometry.getAttribute("position");
    positionCount = position?.count ?? 0;
    triangleCount = mesh.geometry.index
      ? mesh.geometry.index.count / 3
      : positionCount / 3;
    if (localBox && current) {
      const rotation = current.rotation ?? [0, 0, 0];
      const runtimeMatrix = new THREE.Matrix4().compose(
        new THREE.Vector3(...current.position),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)),
        new THREE.Vector3(...current.scale),
      );
      runtimeBox = localBox.clone().applyMatrix4(runtimeMatrix);
    }
  }
  const camera = state()?.camera;
  const islandSettled = closeToIdentity(island?.matrixWorld);
  return {
    assetId,
    projectPosition: current?.position ?? null,
    assetReady: isAssetGeometryReady(assetId),
    mesh: mesh
      ? {
          visible: mesh.visible,
          parentVisible,
          positionCount,
          triangleCount,
          particleBridge,
          settled: mesh.visible && particleBridge === true,
          localBounds: bounds(localBox),
          worldBounds: bounds(worldBox),
          runtimeBounds: bounds(runtimeBox),
          userData: { ...mesh.geometry.userData },
        }
      : null,
    islandTransition: {
      settled: islandSettled,
      visible: island?.visible ?? false,
      worldMatrix: matrixValues(island?.matrixWorld),
    },
    renderer: rendererDetails(),
    browser: {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      hardwareConcurrency: navigator.hardwareConcurrency,
      devicePixelRatio: window.devicePixelRatio,
      viewport: { width: innerWidth, height: innerHeight },
    },
    camera: camera
      ? {
          position: vector(camera.position),
          quaternion: [
            camera.quaternion.x,
            camera.quaternion.y,
            camera.quaternion.z,
            camera.quaternion.w,
          ],
        }
      : null,
  };
}

let project: Project;
const loaded = blankProject();
loaded.id = projectId;
loaded.title = "Mushroom placement comparison";
loaded.seed = 42;
loaded.environment = { sky: "#dceee9", ground: "#91b977", water: "#59bdbb" };
project = { ...loaded, entities: [baseEntity] };

// Load once through the application store so World and its shared asset loader
// run exactly as they do for a saved project. No provider or persistence calls
// are made by this fixture.
useOrb.setState({
  project,
  phase: "editing",
  playing: false,
  building: false,
  selected: undefined,
  error: "",
});
const root = createRoot(document.getElementById("root")!);
root.render(<World />);

function setY(y: number) {
  const entity = {
    ...baseEntity,
    position: [x, y, z] as [number, number, number],
  };
  project = { ...project, revision: project.revision + 1, entities: [entity] };
  useOrb.setState({ project });
  return status();
}

(
  window as unknown as {
    mushroomPlacementFixture: {
      ready: () => boolean;
      setY: (y: number) => unknown;
      status: () => unknown;
    };
  }
).mushroomPlacementFixture = {
  ready: () => {
    const current = status();
    return (
      !!state() &&
      current.assetReady &&
      !!current.mesh &&
      current.mesh.visible &&
      current.mesh.parentVisible &&
      current.mesh.settled &&
      current.islandTransition.settled &&
      current.mesh.positionCount > 0 &&
      current.mesh.triangleCount > 0
    );
  },
  setY,
  status,
};
