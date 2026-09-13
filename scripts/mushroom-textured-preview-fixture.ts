import * as THREE from "three";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { TGALoader } from "three/addons/loaders/TGALoader.js";

const background = new THREE.Color("#07110e");
const cameraPosition = new THREE.Vector3(1.7, 1.2, 2);
const lookAt = new THREE.Vector3(0, 0.5, 0);
const panelSize = 420;
const pinkColor = new THREE.Color("#ff69b4");

type PreviewFixture = {
  ready: () => boolean;
  status: () => unknown;
  renderRear: () => boolean;
};

declare global {
  interface Window {
    mushroomTexturedPreviewFixture: PreviewFixture;
  }
}

function meshOf(object: THREE.Object3D): THREE.Mesh | undefined {
  return object instanceof THREE.Mesh ? object : undefined;
}

function materialColor(material: THREE.Material): THREE.Color {
  return "color" in material && material.color instanceof THREE.Color
    ? material.color.clone()
    : new THREE.Color(0xffffff);
}

function materialMap(material: THREE.Material): THREE.Texture | null {
  return "map" in material && material.map instanceof THREE.Texture
    ? material.map
    : null;
}

type TextureImageDimensions = { width: number; height: number };

function hasImageDimensions(value: unknown): value is TextureImageDimensions {
  if (typeof value !== "object" || value === null) return false;
  if (!("width" in value) || !("height" in value)) return false;
  return (
    typeof value.width === "number" &&
    Number.isFinite(value.width) &&
    Number.isInteger(value.width) &&
    value.width > 0 &&
    typeof value.height === "number" &&
    Number.isFinite(value.height) &&
    Number.isInteger(value.height) &&
    value.height > 0
  );
}

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
  if (!Number.isFinite(height) || height <= 0) throw new Error("Source height is invalid.");
  const centerX = (sourceBounds.min.x + sourceBounds.max.x) / 2;
  const centerZ = (sourceBounds.min.z + sourceBounds.max.z) / 2;
  root.scale.setScalar(1 / height);
  root.position.set(-centerX / height, -sourceBounds.min.y / height, -centerZ / height);
  root.updateMatrixWorld(true);
  return boundsOf(root);
}

function replaceWithStandardMaterial(root: THREE.Object3D) {
  root.traverse((object) => {
    const mesh = meshOf(object);
    if (!mesh) return;
    const materials: THREE.Material[] = Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material];
    const replacement = materials.map(
      (material) =>
        new THREE.MeshStandardMaterial({
          color: materialColor(material),
          map: materialMap(material),
          roughness: 0.8,
          metalness: 0,
          name: `${material.name}_preview_standard`,
        }),
    );
    mesh.material = Array.isArray(mesh.material) ? replacement : replacement[0];
  });
}

function makePinkComparator(root: THREE.Object3D) {
  const pink = root.clone(true);
  pink.traverse((object) => {
    const mesh = meshOf(object);
    if (!mesh) return;
    const hadMaterialArray = Array.isArray(mesh.material);
    const materials: THREE.Material[] = Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material];
    const replacement = materials.map(
      (material) =>
        new THREE.MeshStandardMaterial({
          color: pinkColor,
          map: null,
          roughness: 0.8,
          metalness: 0,
          name: `${material.name}_preview_uniform_pink`,
        }),
    );
    mesh.material = hadMaterialArray ? replacement : replacement[0];
  });
  return pink;
}

function assertTexture(root: THREE.Object3D, expectedWidth: number, label: string) {
  const textures: THREE.Texture[] = [];
  root.traverse((object) => {
    const mesh = meshOf(object);
    if (!mesh) return;
    const materials: THREE.Material[] = Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material];
    for (const material of materials) {
      const map = materialMap(material);
      if (map) textures.push(map);
    }
  });
  if (!textures.length) throw new Error(`${label} has no color texture.`);
  const dimensions = textures.map((texture) => {
    if (!hasImageDimensions(texture.image))
      throw new Error(`${label} has a texture without validated image dimensions.`);
    return texture.image;
  });
  if (dimensions.some(({ width, height }) => width !== expectedWidth || height !== expectedWidth))
    throw new Error(`${label} texture width is not ${expectedWidth}.`);
  const first = dimensions[0];
  if (!first) throw new Error(`${label} texture dimensions are missing.`);
  return { texture: textures[0], width: first.width, height: first.height };
}

function assertPink(root: THREE.Object3D) {
  root.traverse((object) => {
    const mesh = meshOf(object);
    if (!mesh) return;
    const materials: THREE.Material[] = Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material];
    if (materials.some((material) => materialMap(material) !== null))
      throw new Error("Uniform pink comparator retained a texture map.");
    if (materials.some((material) => materialColor(material).getHex() !== pinkColor.getHex()))
      throw new Error("Uniform pink comparator material color is incorrect.");
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
  return { render, renderer, bounds: boundsOf(object) };
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
const fullTexture = new THREE.DataTexture(
  tgaData.data,
  tgaData.width,
  tgaData.height,
  THREE.RGBAFormat,
  THREE.UnsignedByteType,
);
fullTexture.flipY = tgaData.flipY ?? false;
fullTexture.colorSpace = THREE.SRGBColorSpace;
fullTexture.needsUpdate = true;

class PreparedTextureLoader extends THREE.Loader<THREE.Texture> {
  constructor(private readonly preparedTexture: THREE.Texture) {
    super();
  }

  override load(
    url: string,
    onLoad?: (value: THREE.Texture) => void,
  ): THREE.Texture {
    const basename = url.replaceAll("\\", "/").split("/").at(-1);
    if (basename !== "Mushrooms_C.tga") throw new Error(`Unexpected TGA request: ${url}`);
    onLoad?.(this.preparedTexture);
    return this.preparedTexture;
  }
}

const manager = new THREE.LoadingManager();
manager.addHandler(/\.tga$/i, new PreparedTextureLoader(fullTexture));
manager.setURLModifier((url) => {
  throw new Error(`Unexpected external resource request: ${url}`);
});
const original = new FBXLoader(manager).parse(fbxBytes.buffer, "/");
original.updateMatrixWorld(true);
replaceWithStandardMaterial(original);
const originalBounds = normalizeSource(original);

const gltf = await new GLTFLoader().parseAsync(glbBytes.buffer, "/");
gltf.scene.updateMatrixWorld(true);
const textured = gltf.scene;
const embeddedTexture = assertTexture(textured, 512, "Embedded textured GLB");
const pink = makePinkComparator(textured);
assertPink(pink);
const texturedBounds = boundsOf(textured);
const pinkBounds = boundsOf(pink);

const root = document.getElementById("root");
if (!root) throw new Error("Preview root is missing.");
const panelEntries: [string, string, THREE.Object3D][] = [
  ["original", "Original full texture (4096px TGA)", original],
  ["embedded", "Embedded atlas (512px PNG)", textured],
  ["pink", "Uniform pink (map removed)", pink],
];
type Panel = ReturnType<typeof makePanel>;
const panels: [string, Panel][] = panelEntries.map(([id, label, object]) => {
  const panel = document.createElement("section");
  panel.innerHTML = `<h2>${label}</h2>`;
  const canvas = document.createElement("canvas");
  canvas.width = panelSize;
  canvas.height = panelSize;
  panel.append(canvas);
  root.append(panel);
  return [id, makePanel(object, canvas)];
});
for (const [, panel] of panels) panel.render();
const rendererContext = panels[1][1].renderer.getContext();
const debug = rendererContext.getExtension("WEBGL_debug_renderer_info");
const renderer = debug
  ? rendererContext.getParameter(debug.UNMASKED_RENDERER_WEBGL)
  : rendererContext.getParameter(rendererContext.RENDERER);
const status = {
  ready: true,
  renderer,
  browser: { userAgent: navigator.userAgent, devicePixelRatio: window.devicePixelRatio },
  camera: { position: cameraPosition.toArray(), lookAt: lookAt.toArray() },
  textures: {
    original: {
      loaded: true,
      width: tgaData.width,
      height: tgaData.height,
      flipY: fullTexture.flipY,
      colorSpace: fullTexture.colorSpace,
    },
    embedded: {
      loaded: true,
      width: embeddedTexture.width,
      height: embeddedTexture.height,
      colorSpace: embeddedTexture.texture.colorSpace,
    },
    pink: { mapRemoved: true, color: `#${pinkColor.getHexString()}` },
  },
  bounds: { original: originalBounds, embedded: texturedBounds, pink: pinkBounds },
};
window.mushroomTexturedPreviewFixture = {
  ready: () => status.ready,
  status: () => status,
  renderRear: () => {
    for (const [, panel] of panels) panel.render(true);
    return true;
  },
};
