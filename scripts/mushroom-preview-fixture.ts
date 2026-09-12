import * as THREE from "three";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { TGALoader } from "three/addons/loaders/TGALoader.js";

const background = new THREE.Color("#07110e");
const cameraPosition = new THREE.Vector3(1.7, 1.2, 2);
const lookAt = new THREE.Vector3(0, 0.5, 0);
const panelSize = 420;

function boundsOf(root: THREE.Object3D) {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  return {
    min: box.min.toArray(),
    max: box.max.toArray(),
    size: box.getSize(new THREE.Vector3()).toArray(),
  };
}

function normalizeSource(root: THREE.Object3D) {
  const sourceBounds = new THREE.Box3().setFromObject(root);
  const height = sourceBounds.max.y - sourceBounds.min.y;
  const centerX = (sourceBounds.min.x + sourceBounds.max.x) / 2;
  const centerZ = (sourceBounds.min.z + sourceBounds.max.z) / 2;
  root.scale.setScalar(1 / height);
  root.position.set(-centerX / height, -sourceBounds.min.y / height, -centerZ / height);
  root.updateMatrixWorld(true);
  return boundsOf(root);
}

function replaceWithStandardMaterial(root: THREE.Object3D) {
  root.traverse((object) => {
    if (!object.isMesh) return;
    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material];
    const replacement = materials.map((material) =>
      new THREE.MeshStandardMaterial({
        color: material.color?.clone() ?? new THREE.Color(0xffffff),
        map: material.map ?? null,
        roughness: 0.8,
        metalness: 0,
        name: `${material.name}_preview_standard`,
      }),
    );
    object.material = Array.isArray(object.material)
      ? replacement
      : replacement[0];
  });
}

function tintPink(root: THREE.Object3D) {
  root.traverse((object) => {
    if (!object.isMesh) return;
    const geometry = object.geometry.clone();
    const sourceColor = geometry.getAttribute("color");
    if (!sourceColor) throw new Error("Baked mesh has no color attribute.");
    const pink = new THREE.Color("#ff69b4");
    const colors = new Float32Array(sourceColor.count * 3);
    for (let index = 0; index < sourceColor.count; index++) {
      colors[index * 3] = pink.r;
      colors[index * 3 + 1] = pink.g;
      colors[index * 3 + 2] = pink.b;
    }
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    object.geometry = geometry;
    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material];
    const replacement = materials.map((material) => {
      const clone = material.clone();
      clone.color.set(0xffffff);
      clone.map = null;
      clone.vertexColors = true;
      return clone;
    });
    object.material = Array.isArray(object.material)
      ? replacement
      : replacement[0];
  });
}

function makePanel(object: THREE.Object3D, canvas: HTMLCanvasElement) {
  const scene = new THREE.Scene();
  scene.background = background;
  scene.add(new THREE.HemisphereLight(0xdff5ee, 0x173629, 2.2));
  const key = new THREE.DirectionalLight(0xffffff, 3.2);
  key.position.set(2.5, 3.5, 4);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x83b8ff, 0.8);
  fill.position.set(-3, 1, -2);
  scene.add(fill);
  scene.add(object);
  const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 20);
  const renderer = new THREE.WebGLRenderer({ antialias: true, canvas });
  renderer.setPixelRatio(1);
  renderer.setSize(panelSize, panelSize, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  const render = (rear = false) => {
    camera.position.copy(cameraPosition);
    if (rear) camera.position.multiplyScalar(-1).setY(cameraPosition.y);
    camera.lookAt(lookAt);
    renderer.render(scene, camera);
  };
  return {
    render,
    renderer,
    camera,
    bounds: boundsOf(object),
  };
}

const [fbxBytes, tgaBytes, glbBytes] = await Promise.all(
  ["/source.fbx", "/source.tga", "/prototype.glb"].map((path) =>
    fetch(path).then(async (response) => {
      if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
      return new Uint8Array(await response.arrayBuffer());
    }),
  ),
);
const tgaData = new TGALoader().parse(tgaBytes.buffer);
const texture = new THREE.DataTexture(
  tgaData.data,
  tgaData.width,
  tgaData.height,
  THREE.RGBAFormat,
  THREE.UnsignedByteType,
);
texture.flipY = tgaData.flipY;
texture.colorSpace = THREE.SRGBColorSpace;
texture.needsUpdate = true;
const textureHandler = {
  path: "",
  setPath(path: string) {
    this.path = path;
    return this;
  },
  load(url: string, onLoad?: (value: THREE.Texture) => void) {
    const basename = url.replaceAll("\\", "/").split("/").at(-1);
    if (basename !== "Mushrooms_C.tga") throw new Error(`Unexpected TGA request: ${url}`);
    onLoad?.(texture);
    return texture;
  },
};
const manager = new THREE.LoadingManager();
manager.addHandler(/\.tga$/i, textureHandler);
manager.setURLModifier((url) => {
  throw new Error(`Unexpected external resource request: ${url}`);
});
const source = new FBXLoader(manager).parse(fbxBytes.buffer, "/");
source.updateMatrixWorld(true);
replaceWithStandardMaterial(source);
const sourceBounds = normalizeSource(source);
const gltf = await new GLTFLoader().parseAsync(glbBytes.buffer, "/");
gltf.scene.updateMatrixWorld(true);
const baked = gltf.scene;
const bakedColorSnapshots: Float32Array[] = [];
baked.traverse((object) => {
  if (!object.isMesh) return;
  const color = object.geometry.getAttribute("color");
  if (!color) throw new Error("Baked mesh has no color attribute.");
  bakedColorSnapshots.push(new Float32Array(color.array));
});
const pink = baked.clone(true);
tintPink(pink);
let pinkSnapshotIndex = 0;
pink.traverse((object) => {
  if (!object.isMesh) return;
  const bakedColor = bakedColorSnapshots[pinkSnapshotIndex++];
  const color = object.geometry.getAttribute("color");
  const pinkColor = new THREE.Color("#ff69b4");
  if (!color || !bakedColor) throw new Error("Pink color assertion inputs are missing.");
  if (color.array === bakedColor || color.array.every((value, index) => value === bakedColor[index]))
    throw new Error("Pink comparator reused or preserved baked color values.");
  for (let index = 0; index < color.count; index++) {
    if (
      Math.abs(color.getX(index) - pinkColor.r) > 1e-6 ||
      Math.abs(color.getY(index) - pinkColor.g) > 1e-6 ||
      Math.abs(color.getZ(index) - pinkColor.b) > 1e-6
    )
      throw new Error("Pink comparator color assertion failed.");
  }
  const materials = Array.isArray(object.material)
    ? object.material
    : [object.material];
  if (materials.some((material) => material.color?.getHex() !== 0xffffff))
    throw new Error("Pink comparator material is not white.");
});

const root = document.getElementById("root");
if (!root) throw new Error("Preview root is missing.");
const panels = [
  ["original", "Original textured FBX", source],
  ["baked", "Baked vertex colors", baked],
  ["pink", "Baked + production pink tint", pink],
].map(([id, label, object]) => {
  const panel = document.createElement("section");
  panel.innerHTML = `<h2>${label}</h2>`;
  const canvas = document.createElement("canvas");
  canvas.width = panelSize;
  canvas.height = panelSize;
  panel.append(canvas);
  root.append(panel);
  return [id, makePanel(object, canvas)];
});
const panelMap = new Map(panels);
for (const [, panel] of panels) panel.render();
const rendererContext = panelMap.get("baked").renderer.getContext();
const debug = rendererContext.getExtension("WEBGL_debug_renderer_info");
const renderer = debug
  ? rendererContext.getParameter(debug.UNMASKED_RENDERER_WEBGL)
  : rendererContext.getParameter(rendererContext.RENDERER);
const status = {
  ready: true,
  renderer,
  browser: { userAgent: navigator.userAgent, devicePixelRatio: window.devicePixelRatio },
  camera: { position: cameraPosition.toArray(), lookAt: lookAt.toArray() },
  texture: {
    loaded: true,
    width: tgaData.width,
    height: tgaData.height,
    flipY: texture.flipY,
    colorSpace: texture.colorSpace,
    wrapS: texture.wrapS,
    wrapT: texture.wrapT,
  },
  bounds: {
    original: sourceBounds,
    baked: panelMap.get("baked").bounds,
    pink: panelMap.get("pink").bounds,
  },
};
window.mushroomPreviewFixture = {
  ready: () => status.ready,
  status: () => status,
  renderRear: () => {
    for (const [, panel] of panels) panel.render(true);
    return true;
  },
};
