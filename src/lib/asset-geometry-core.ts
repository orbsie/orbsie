import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import {
  assetManifest,
  requireCatalogAsset,
  type AssetId,
  type CatalogAsset,
} from "./asset-catalog";
import { AssetGeometryError } from "./asset-geometry-error";
import {
  prepareFormationParticles,
  type FormationTextureSample,
} from "./formation-particles";
import { createAssetDataTexture } from "./asset-texture";

/** Typed arrays are transferred to the editor thread without a JSON copy. */
export type AssetGeometryArray =
  | Float32Array
  | Float64Array
  | Int8Array
  | Uint8Array
  | Uint8ClampedArray
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array;

export interface AssetGeometryAttributeTransfer {
  readonly array: AssetGeometryArray;
  readonly itemSize: number;
  readonly normalized: boolean;
}

export interface AssetGeometryBoundsTransfer {
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
}

export interface AssetGeometrySphereTransfer {
  readonly center: readonly [number, number, number];
  readonly radius: number;
}

export type AssetTextureColorSpace = "srgb" | "srgb-linear" | "";

/** Decoded base-color pixels transferred out of the catalog worker. */
export interface AssetBaseColorTextureTransfer {
  readonly pixels: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly colorSpace: AssetTextureColorSpace;
  /** Three.js wrapping/filter enum values, after glTF enum conversion. */
  readonly wrapS: THREE.Wrapping;
  readonly wrapT: THREE.Wrapping;
  readonly magFilter: THREE.MagnificationTextureFilter;
  readonly minFilter: THREE.MinificationTextureFilter;
  readonly generateMipmaps: boolean;
  readonly channel: number;
}

/** Structured clone/transfer payload emitted by the catalog worker. */
export interface AssetGeometryTransfer {
  readonly attributes: Readonly<Record<string, AssetGeometryAttributeTransfer>>;
  readonly box: AssetGeometryBoundsTransfer;
  readonly sphere: AssetGeometrySphereTransfer;
  readonly byteLength: number;
  readonly baseColorTexture?: AssetBaseColorTextureTransfer;
  readonly userData: Readonly<Record<string, unknown>>;
}

export interface PreparedAssetGeometry {
  readonly geometry: THREE.BufferGeometry;
  readonly baseColorTexture?: AssetBaseColorTextureTransfer;
}

export interface DecodeAssetGeometryOptions {
  /** Maximum bytes accepted by the decoder, including worker direct calls. */
  readonly maxAssetBytes?: number;
  /** Verify checked-in manifest size and SHA-256 before parsing. */
  readonly verifyManifest?: boolean;
}

function positiveBound(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0)
    throw new RangeError(`${name} must be positive.`);
  return Math.floor(value);
}

function asBytes(value: Uint8Array | ArrayBuffer): Uint8Array {
  return value instanceof Uint8Array ? value : new Uint8Array(value);
}

function bytesOfGeometry(geometry: THREE.BufferGeometry): number {
  let bytes = 0;
  for (const attribute of Object.values(geometry.attributes)) {
    bytes += (attribute.array as ArrayBufferView).byteLength;
  }
  if (geometry.index) bytes += geometry.index.array.byteLength;
  return bytes;
}

function disposeObjectResources(root: THREE.Object3D): void {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry?.dispose();
    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : mesh.material
        ? [mesh.material]
        : [];
    for (const material of materials) {
      for (const value of Object.values(material)) {
        if (
          value &&
          typeof value === "object" &&
          (value as THREE.Texture).isTexture
        )
          (value as THREE.Texture).dispose();
      }
      material.dispose();
    }
  });
}

function cloneAttributeRange(
  attribute: THREE.BufferAttribute,
  start: number,
  count: number,
): THREE.BufferAttribute {
  if (
    "isInterleavedBufferAttribute" in attribute &&
    attribute.isInterleavedBufferAttribute
  )
    throw new AssetGeometryError(
      "parse-failed",
      "Interleaved asset attributes are not supported by formation geometry.",
    );
  const itemSize = attribute.itemSize;
  const values = attribute.array.slice(
    start * itemSize,
    (start + count) * itemSize,
  ) as typeof attribute.array;
  return new THREE.BufferAttribute(values, itemSize, attribute.normalized);
}

function asNonIndexedPart(
  source: THREE.BufferGeometry,
  start = 0,
  count = source.index?.count ?? source.getAttribute("position")?.count ?? 0,
): THREE.BufferGeometry {
  const nonIndexed = source.index ? source.toNonIndexed() : source.clone();
  const part = new THREE.BufferGeometry();
  try {
    for (const [name, attribute] of Object.entries(nonIndexed.attributes))
      part.setAttribute(
        name,
        cloneAttributeRange(attribute as THREE.BufferAttribute, start, count),
      );
    return part;
  } catch (error) {
    part.dispose();
    throw error;
  } finally {
    nonIndexed.dispose();
  }
}

function materialColor(material: THREE.Material | undefined): THREE.Color {
  const color = material && "color" in material ? material.color : undefined;
  return color instanceof THREE.Color
    ? color.clone()
    : new THREE.Color(0xffffff);
}

function addVertexColors(
  geometry: THREE.BufferGeometry,
  material: THREE.Material | undefined,
): void {
  const position = geometry.getAttribute("position");
  if (!position)
    throw new AssetGeometryError(
      "empty-geometry",
      "Asset mesh has no position attribute.",
    );
  const source = geometry.getAttribute("color");
  const color = materialColor(material);
  const colors = new Float32Array(position.count * 3);
  for (let index = 0; index < position.count; index++) {
    if (source) {
      colors[index * 3] = color.r * source.getX(index);
      colors[index * 3 + 1] = color.g * source.getY(index);
      colors[index * 3 + 2] = color.b * source.getZ(index);
    } else {
      colors[index * 3] = color.r;
      colors[index * 3 + 1] = color.g;
      colors[index * 3 + 2] = color.b;
    }
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
}

function localResourceUrl(url: string, expectedPath: string): string {
  // Catalog GLBs are self-contained. URLModifier sees every requested image,
  // buffer, and nested resource, so accepting only the exact GLB path prevents
  // a catalog model from loading arbitrary external resources.
  let parsed: URL;
  try {
    parsed = new URL(url, "https://orbsie.local");
  } catch (error) {
    throw new AssetGeometryError(
      "unsafe-url",
      `Invalid asset resource URL ${url}.`,
      { cause: error },
    );
  }
  if (
    parsed.origin !== "https://orbsie.local" ||
    parsed.pathname !== expectedPath ||
    parsed.search ||
    parsed.hash
  )
    throw new AssetGeometryError(
      "unsafe-url",
      `Asset ${expectedPath} attempted to reference an external resource ${url}.`,
    );
  return expectedPath;
}

function parseManager(expectedPath: string): THREE.LoadingManager {
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => localResourceUrl(url, expectedPath));
  return manager;
}

type JsonObject = Record<string, unknown>;

function jsonObject(value: unknown): JsonObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

function jsonArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function integer(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

interface ParsedGlb {
  readonly json: JsonObject;
  readonly binary: Uint8Array;
}

function parseGlb(bytes: Uint8Array): ParsedGlb {
  if (bytes.byteLength < 20)
    throw new AssetGeometryError(
      "parse-failed",
      "Catalog GLB header is truncated.",
    );
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2)
    throw new AssetGeometryError(
      "parse-failed",
      "Catalog asset is not a GLB 2.0 file.",
    );
  if (view.getUint32(8, true) !== bytes.byteLength)
    throw new AssetGeometryError(
      "parse-failed",
      "Catalog GLB length is invalid.",
    );
  let offset = 12;
  let jsonChunk: Uint8Array | undefined;
  let binary = new Uint8Array(0);
  while (offset < bytes.byteLength) {
    if (offset + 8 > bytes.byteLength)
      throw new AssetGeometryError(
        "parse-failed",
        "Catalog GLB chunk header is truncated.",
      );
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    const end = offset + 8 + length;
    if (end > bytes.byteLength)
      throw new AssetGeometryError(
        "parse-failed",
        "Catalog GLB chunk exceeds its container.",
      );
    const chunk = bytes.subarray(offset + 8, end);
    if (type === 0x4e4f534a) {
      if (jsonChunk)
        throw new AssetGeometryError(
          "parse-failed",
          "Catalog GLB has multiple JSON chunks.",
        );
      jsonChunk = chunk;
    } else if (type === 0x004e4942) {
      if (binary.byteLength)
        throw new AssetGeometryError(
          "parse-failed",
          "Catalog GLB has multiple BIN chunks.",
        );
      binary = new Uint8Array(chunk);
    }
    offset = end;
  }
  if (!jsonChunk)
    throw new AssetGeometryError(
      "parse-failed",
      "Catalog GLB has no JSON chunk.",
    );
  try {
    const json = jsonObject(
      JSON.parse(new TextDecoder().decode(jsonChunk).trim()),
    );
    if (!json) throw new Error("JSON root is not an object");
    return { json, binary };
  } catch (error) {
    throw new AssetGeometryError(
      "parse-failed",
      "Catalog GLB JSON is invalid.",
      {
        cause: error,
      },
    );
  }
}

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const MAX_TEXTURE_COMPRESSED_BYTES = 2 * 1024 * 1024;
const MAX_TEXTURE_DIMENSION = 1024;
const MAX_TEXTURE_PIXELS = MAX_TEXTURE_DIMENSION * MAX_TEXTURE_DIMENSION;
const GLTF_FILTERS = new Set([9728, 9729, 9984, 9985, 9986, 9987]);
const GLTF_WRAPPINGS = new Set([33071, 33648, 10497]);

interface EmbeddedTextureInfo {
  readonly mapIndex: number;
  readonly png: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly wrapS: THREE.Wrapping;
  readonly wrapT: THREE.Wrapping;
  readonly magFilter: THREE.MagnificationTextureFilter;
  readonly minFilter: THREE.MinificationTextureFilter;
  readonly channel: number;
}

function pngDimensions(png: Uint8Array): [number, number] {
  if (
    png.byteLength < 33 ||
    PNG_SIGNATURE.some((value, index) => png[index] !== value)
  )
    throw new AssetGeometryError(
      "parse-failed",
      "Embedded base-color image is not a PNG.",
    );
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  if (
    view.getUint32(8, false) !== 13 ||
    view.getUint32(12, false) !== 0x49484452
  )
    throw new AssetGeometryError(
      "parse-failed",
      "Embedded PNG has no valid IHDR header.",
    );
  const width = view.getUint32(16, false);
  const height = view.getUint32(20, false);
  if (
    width < 1 ||
    height < 1 ||
    width > MAX_TEXTURE_DIMENSION ||
    height > MAX_TEXTURE_DIMENSION ||
    width * height > MAX_TEXTURE_PIXELS
  )
    throw new AssetGeometryError(
      "too-large",
      `Embedded PNG dimensions ${width}x${height} exceed the ${MAX_TEXTURE_DIMENSION}px image limit.`,
    );
  return [width, height];
}

function samplerNumber(
  value: unknown,
  allowed: ReadonlySet<number>,
  fallback: number,
  label: string,
): number {
  if (value === undefined) return fallback;
  if (!integer(value) || !allowed.has(value))
    throw new AssetGeometryError(
      "parse-failed",
      `Embedded texture has an unsupported ${label}.`,
    );
  return value;
}

function gltfWrapping(value: unknown, label: string): THREE.Wrapping {
  switch (samplerNumber(value, GLTF_WRAPPINGS, 10497, label)) {
    case 33071:
      return THREE.ClampToEdgeWrapping;
    case 33648:
      return THREE.MirroredRepeatWrapping;
    default:
      return THREE.RepeatWrapping;
  }
}

function gltfMagnificationFilter(
  value: unknown,
): THREE.MagnificationTextureFilter {
  return samplerNumber(value, new Set([9728, 9729]), 9729, "magFilter") === 9728
    ? THREE.NearestFilter
    : THREE.LinearFilter;
}

function gltfMinificationFilter(
  value: unknown,
): THREE.MinificationTextureFilter {
  switch (samplerNumber(value, GLTF_FILTERS, 9987, "minFilter")) {
    case 9728:
      return THREE.NearestFilter;
    case 9729:
      return THREE.LinearFilter;
    case 9984:
      return THREE.NearestMipmapNearestFilter;
    case 9985:
      return THREE.LinearMipmapNearestFilter;
    case 9986:
      return THREE.NearestMipmapLinearFilter;
    default:
      return THREE.LinearMipmapLinearFilter;
  }
}

function validateEmbeddedTexture(
  json: JsonObject,
  binary: Uint8Array,
  maxAssetBytes: number,
): EmbeddedTextureInfo | undefined {
  // Keep material-array positions intact. A malformed entry must not shift the
  // index used by a primitive below; untextured assets retain their old loader
  // behavior, while textured primitives are validated explicitly.
  const materials = jsonArray(json.materials).map(jsonObject);
  const mapIndices = new Set<number>();
  let hasAnyTextureMap = false;
  for (const material of materials) {
    if (!material) continue;
    if (material.alphaMode !== undefined && material.alphaMode !== "OPAQUE")
      throw new AssetGeometryError(
        "parse-failed",
        "Only OPAQUE alpha mode is supported for textured catalog assets.",
      );
    if (material.doubleSided === true)
      throw new AssetGeometryError(
        "parse-failed",
        "Double-sided textured catalog materials are unsupported.",
      );
    const pbr = jsonObject(material.pbrMetallicRoughness);
    const baseColor = jsonObject(pbr?.baseColorTexture);
    const unsupportedMaps = [
      material.normalTexture,
      material.occlusionTexture,
      material.emissiveTexture,
      pbr?.metallicRoughnessTexture,
    ];
    if (unsupportedMaps.some((map) => map !== undefined))
      throw new AssetGeometryError(
        "parse-failed",
        "Only base-color texture maps are supported for textured catalog assets.",
      );
    const pbrExtensions = jsonObject(pbr?.extensions);
    if (pbrExtensions && Object.keys(pbrExtensions).length)
      throw new AssetGeometryError(
        "parse-failed",
        "Textured material extensions are unsupported.",
      );
    if (baseColor) {
      hasAnyTextureMap = true;
      if (!integer(baseColor.index))
        throw new AssetGeometryError(
          "parse-failed",
          "Base-color texture index is invalid.",
        );
      if (baseColor.texCoord !== undefined && baseColor.texCoord !== 0)
        throw new AssetGeometryError(
          "parse-failed",
          "Only TEXCOORD_0 base-color maps are supported.",
        );
      if (
        jsonObject(baseColor.extensions) &&
        Object.keys(baseColor.extensions as JsonObject).length
      )
        throw new AssetGeometryError(
          "parse-failed",
          "Base-color texture extensions are unsupported.",
        );
      mapIndices.add(baseColor.index);
    }
    if (
      jsonObject(material.extensions) &&
      Object.keys(material.extensions as JsonObject).length
    )
      throw new AssetGeometryError(
        "parse-failed",
        "Textured material extensions are unsupported.",
      );
  }
  if (!hasAnyTextureMap) return undefined;
  if (mapIndices.size === 0)
    throw new AssetGeometryError(
      "parse-failed",
      "Only base-color texture maps are supported.",
    );
  if (mapIndices.size !== 1)
    throw new AssetGeometryError(
      "parse-failed",
      "Multiple distinct base-color maps are unsupported.",
    );
  if (
    jsonArray(json.extensionsUsed).length ||
    jsonArray(json.extensionsRequired).length
  )
    throw new AssetGeometryError(
      "parse-failed",
      "glTF extensions are unsupported for textured catalog assets.",
    );
  const mapIndex = [...mapIndices][0];
  const textures = jsonArray(json.textures);
  const images = jsonArray(json.images);
  if (textures.length !== 1 || images.length !== 1 || mapIndex !== 0)
    throw new AssetGeometryError(
      "parse-failed",
      "Textured catalog assets must contain one base-color texture and image.",
    );
  const texture = jsonObject(textures[0]);
  const image = jsonObject(images[0]);
  if (!texture || !image || texture.source !== 0)
    throw new AssetGeometryError(
      "parse-failed",
      "Textured catalog image references are invalid.",
    );
  if (
    jsonObject(texture.extensions) &&
    Object.keys(texture.extensions as JsonObject).length
  )
    throw new AssetGeometryError(
      "parse-failed",
      "Texture extensions are unsupported.",
    );
  if (Object.hasOwn(image, "uri"))
    throw new AssetGeometryError(
      "unsafe-url",
      "External and data URI catalog images are unsupported.",
    );
  if (image.mimeType !== "image/png" || !integer(image.bufferView))
    throw new AssetGeometryError(
      "parse-failed",
      "Only embedded PNG base-color images are supported.",
    );
  const view = jsonArray(json.bufferViews)[image.bufferView];
  const imageView = jsonObject(view);
  if (!imageView || (imageView.buffer !== undefined && imageView.buffer !== 0))
    throw new AssetGeometryError(
      "parse-failed",
      "Embedded PNG bufferView must reference the GLB BIN chunk.",
    );
  const byteOffset = imageView.byteOffset ?? 0;
  const byteLength = imageView.byteLength;
  if (
    !integer(byteOffset) ||
    byteOffset < 0 ||
    !integer(byteLength) ||
    byteLength < 1
  )
    throw new AssetGeometryError(
      "parse-failed",
      "Embedded PNG bufferView range is invalid.",
    );
  if (byteLength > Math.min(maxAssetBytes, MAX_TEXTURE_COMPRESSED_BYTES))
    throw new AssetGeometryError(
      "too-large",
      "Embedded PNG exceeds the compressed image byte limit.",
    );
  const end = byteOffset + byteLength;
  if (end > binary.byteLength)
    throw new AssetGeometryError(
      "parse-failed",
      "Embedded PNG bufferView exceeds the GLB BIN chunk.",
    );
  const png = binary.subarray(byteOffset, end);
  const [width, height] = pngDimensions(png);
  const samplers = jsonArray(json.samplers);
  const sampler =
    texture.sampler === undefined
      ? undefined
      : jsonObject(samplers[texture.sampler as number]);
  if (texture.sampler !== undefined && !sampler)
    throw new AssetGeometryError(
      "parse-failed",
      "Embedded texture sampler index is invalid.",
    );
  const wrapS = gltfWrapping(sampler?.wrapS, "wrapS");
  const wrapT = gltfWrapping(sampler?.wrapT, "wrapT");
  const magFilter = gltfMagnificationFilter(sampler?.magFilter);
  const minFilter = gltfMinificationFilter(sampler?.minFilter);
  const meshes = jsonArray(json.meshes)
    .map(jsonObject)
    .filter((mesh): mesh is JsonObject => mesh !== undefined);
  for (const mesh of meshes) {
    for (const primitive of jsonArray(mesh.primitives)
      .map(jsonObject)
      .filter((item): item is JsonObject => item !== undefined)) {
      const attributes = jsonObject(primitive.attributes);
      const materialIndex = primitive.material;
      if (
        !integer(materialIndex) ||
        materialIndex < 0 ||
        materialIndex >= materials.length
      )
        throw new AssetGeometryError(
          "parse-failed",
          "Textured catalog primitives require an explicit valid material index.",
        );
      const material = materials[materialIndex];
      const materialBaseColor = jsonObject(material?.pbrMetallicRoughness);
      const materialMap = jsonObject(materialBaseColor?.baseColorTexture);
      if (!attributes || !integer(attributes.TEXCOORD_0))
        throw new AssetGeometryError(
          "parse-failed",
          "Textured catalog primitives require TEXCOORD_0.",
        );
      if (!materialMap || materialMap.index !== mapIndex)
        throw new AssetGeometryError(
          "parse-failed",
          "Mixed textured and untextured materials are unsupported.",
        );
    }
  }
  return {
    mapIndex,
    png,
    width,
    height,
    wrapS,
    wrapT,
    magFilter,
    minFilter,
    channel: 0,
  };
}

async function decodePngRgba(info: EmbeddedTextureInfo): Promise<Uint8Array> {
  if (
    typeof createImageBitmap !== "function" ||
    typeof OffscreenCanvas === "undefined"
  )
    throw new AssetGeometryError(
      "parse-failed",
      "PNG catalog decoding requires worker image APIs.",
    );
  let bitmap: ImageBitmap | undefined;
  try {
    const pngBuffer = new ArrayBuffer(info.png.byteLength);
    new Uint8Array(pngBuffer).set(info.png);
    bitmap = await createImageBitmap(
      new Blob([pngBuffer], { type: "image/png" }),
    );
    if (bitmap.width !== info.width || bitmap.height !== info.height)
      throw new AssetGeometryError(
        "parse-failed",
        "Embedded PNG dimensions do not match its IHDR header.",
      );
    const canvas = new OffscreenCanvas(info.width, info.height);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context)
      throw new AssetGeometryError(
        "parse-failed",
        "Worker could not create a PNG decode canvas.",
      );
    context.clearRect(0, 0, info.width, info.height);
    context.drawImage(bitmap, 0, 0);
    return new Uint8Array(
      context.getImageData(0, 0, info.width, info.height).data,
    );
  } catch (error) {
    if (error instanceof AssetGeometryError) throw error;
    throw new AssetGeometryError(
      "parse-failed",
      "Embedded PNG decode failed.",
      { cause: error },
    );
  } finally {
    bitmap?.close();
  }
}

function mergeSourceGeometry(
  gltf: { scene: THREE.Group },
  asset: CatalogAsset,
  maxVertices: number,
  maxGeometryBytes: number,
  preserveUv: boolean,
  particleTexture?: AssetBaseColorTextureTransfer,
): THREE.BufferGeometry {
  gltf.scene.updateMatrixWorld(true);
  const parts: THREE.BufferGeometry[] = [];
  let vertices = 0;
  let merged: THREE.BufferGeometry | undefined;
  try {
    gltf.scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      if ((mesh as THREE.SkinnedMesh).isSkinnedMesh)
        throw new AssetGeometryError(
          "parse-failed",
          `${asset.id} contains a skinned mesh; static formation geometry is required.`,
        );
      const source = mesh.geometry;
      const position = source.getAttribute("position");
      if (!position)
        throw new AssetGeometryError(
          "empty-geometry",
          `${asset.id} contains a mesh without positions.`,
        );
      const materials: THREE.Material[] = Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material];
      const groups = source.groups.length
        ? source.groups
        : [
            {
              start: 0,
              count: source.index?.count ?? position.count,
              materialIndex: 0,
            },
          ];
      const meshParts: THREE.BufferGeometry[] = [];
      try {
        for (const group of groups) {
          const part = asNonIndexedPart(source, group.start, group.count);
          for (const name of [
            ...(preserveUv ? [] : ["uv"]),
            "uv1",
            "uv2",
            "tangent",
            "skinIndex",
            "skinWeight",
          ])
            part.deleteAttribute(name);
          if (preserveUv && !part.getAttribute("uv"))
            throw new AssetGeometryError(
              "parse-failed",
              `${asset.id} textured geometry is missing TEXCOORD_0.`,
            );
          if (!part.getAttribute("normal")) part.computeVertexNormals();
          addVertexColors(
            part,
            materials[group.materialIndex ?? 0] ?? materials[0],
          );
          part.applyMatrix4(mesh.matrixWorld);
          meshParts.push(part);
        }
      } catch (error) {
        meshParts.forEach((part) => part.dispose());
        throw error;
      }
      vertices += meshParts.reduce(
        (total, part) => total + part.getAttribute("position").count,
        0,
      );
      if (vertices > maxVertices) {
        meshParts.forEach((part) => part.dispose());
        throw new AssetGeometryError(
          "too-large",
          `${asset.id} exceeds the ${maxVertices.toLocaleString()} vertex limit.`,
        );
      }
      parts.push(...meshParts);
    });
    if (!parts.length)
      throw new AssetGeometryError(
        "empty-geometry",
        `${asset.id} contains no mesh geometry.`,
      );
    merged = mergeGeometries(parts, false);
    if (!merged)
      throw new AssetGeometryError(
        "parse-failed",
        `Could not merge ${asset.id} geometry.`,
      );
    merged.computeBoundingBox();
    merged.computeBoundingSphere();
    prepareFormationParticles(
      merged,
      preserveUv && particleTexture
        ? (particleTexture satisfies FormationTextureSample)
        : undefined,
    );
    const bytes = bytesOfGeometry(merged);
    if (bytes > maxGeometryBytes) {
      merged.dispose();
      throw new AssetGeometryError(
        "too-large",
        `${asset.id} merged geometry exceeds the ${maxGeometryBytes} byte limit.`,
      );
    }
    merged.userData.orbsieAssetId = asset.id;
    merged.userData.orbsieAssetPath = asset.path;
    merged.userData.sourceTransformsPreserved = true;
    merged.userData.sourceMaterialColorsPreserved = true;
    return merged;
  } catch (error) {
    merged?.dispose();
    throw error;
  } finally {
    parts.forEach((part) => part.dispose());
  }
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle)
    throw new AssetGeometryError(
      "integrity-failed",
      "This runtime cannot verify catalog asset integrity.",
    );
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", copy);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function unknownAsset(value: unknown): AssetGeometryError {
  return new AssetGeometryError(
    "unknown-id",
    `Unknown catalog asset ID ${JSON.stringify(value)}.`,
  );
}

/** Decode and validate one catalog asset. This function is worker safe. */
export async function decodeAssetGeometry(
  value: Uint8Array | ArrayBuffer,
  id: AssetId | string,
  maxVertices: number,
  maxGeometryBytes: number,
  options: DecodeAssetGeometryOptions = {},
): Promise<AssetGeometryTransfer> {
  let asset: CatalogAsset;
  try {
    asset = requireCatalogAsset(id);
  } catch (error) {
    throw unknownAsset(id);
  }
  const bytes = asBytes(value);
  const maxAssetBytes = positiveBound(
    options.maxAssetBytes ?? assetManifest.policy.maxCheckedInBytes,
    "maxAssetBytes",
  );
  if (bytes.byteLength > maxAssetBytes)
    throw new AssetGeometryError(
      "too-large",
      `Asset ${asset.id} is larger than the ${maxAssetBytes} byte read limit.`,
    );
  const verifyManifest = options.verifyManifest ?? true;
  if (verifyManifest) {
    if (bytes.byteLength !== asset.sizeBytes)
      throw new AssetGeometryError(
        "integrity-failed",
        `Asset ${asset.id} does not match its manifest size.`,
      );
    if ((await sha256Hex(bytes)) !== asset.sha256)
      throw new AssetGeometryError(
        "integrity-failed",
        `Asset ${asset.id} does not match its manifest SHA-256.`,
      );
  }
  const vertexLimit = positiveBound(maxVertices, "maxVertices");
  const geometryLimit = positiveBound(maxGeometryBytes, "maxGeometryBytes");
  const { json, binary } = parseGlb(bytes);
  const textureInfo = validateEmbeddedTexture(json, binary, maxAssetBytes);
  if (textureInfo && textureInfo.width * textureInfo.height * 4 > geometryLimit)
    throw new AssetGeometryError(
      "too-large",
      `${asset.id} decoded base-color texture exceeds the ${geometryLimit} byte limit.`,
    );
  let decodedTexture: THREE.DataTexture | undefined;
  let baseColorTexture: AssetBaseColorTextureTransfer | undefined;
  let gltf: Awaited<ReturnType<GLTFLoader["parseAsync"]>> | undefined;
  try {
    const parseBuffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(parseBuffer).set(bytes);
    const loader = new GLTFLoader(parseManager(asset.path));
    if (textureInfo) {
      const pixels = await decodePngRgba(textureInfo);
      const preparedTexture: AssetBaseColorTextureTransfer = {
        pixels,
        width: textureInfo.width,
        height: textureInfo.height,
        colorSpace: "srgb",
        wrapS: textureInfo.wrapS,
        wrapT: textureInfo.wrapT,
        magFilter: textureInfo.magFilter,
        minFilter: textureInfo.minFilter,
        generateMipmaps:
          textureInfo.minFilter !== THREE.NearestFilter &&
          textureInfo.minFilter !== THREE.LinearFilter,
        channel: textureInfo.channel,
      };
      baseColorTexture = preparedTexture;
      decodedTexture = createAssetDataTexture(preparedTexture);
      loader.register(() => ({
        name: "orbsie-embedded-base-color",
        loadTexture(textureIndex) {
          return textureIndex === textureInfo.mapIndex
            ? Promise.resolve(decodedTexture!.clone())
            : null;
        },
      }));
    }
    gltf = await loader.parseAsync(parseBuffer, asset.path);
    let geometry: THREE.BufferGeometry | undefined;
    let transferred = false;
    try {
      geometry = mergeSourceGeometry(
        gltf,
        asset,
        vertexLimit,
        geometryLimit,
        textureInfo !== undefined,
        baseColorTexture,
      );
      const box = geometry.boundingBox;
      const sphere = geometry.boundingSphere;
      if (!box || !sphere)
        throw new AssetGeometryError(
          "parse-failed",
          `Could not compute bounds for ${asset.id}.`,
        );
      const attributes = Object.fromEntries(
        Object.entries(geometry.attributes).map(([name, attribute]) => [
          name,
          {
            array: attribute.array as AssetGeometryArray,
            itemSize: attribute.itemSize,
            normalized: attribute.normalized,
          },
        ]),
      ) as Record<string, AssetGeometryAttributeTransfer>;
      const byteLength =
        bytesOfGeometry(geometry) + (baseColorTexture?.pixels.byteLength ?? 0);
      if (byteLength > geometryLimit)
        throw new AssetGeometryError(
          "too-large",
          `${asset.id} prepared geometry and texture exceed the ${geometryLimit} byte limit.`,
        );
      const transfer: AssetGeometryTransfer = {
        attributes,
        box: {
          min: [box.min.x, box.min.y, box.min.z],
          max: [box.max.x, box.max.y, box.max.z],
        },
        sphere: {
          center: [sphere.center.x, sphere.center.y, sphere.center.z],
          radius: sphere.radius,
        },
        byteLength,
        ...(baseColorTexture ? { baseColorTexture } : {}),
        userData: { ...geometry.userData },
      };
      geometry.dispose();
      transferred = true;
      return transfer;
    } finally {
      if (!transferred) geometry?.dispose();
    }
  } catch (error) {
    if (error instanceof AssetGeometryError) throw error;
    throw new AssetGeometryError(
      "parse-failed",
      `Could not parse catalog asset ${asset.id}.`,
      { cause: error },
    );
  } finally {
    if (gltf) disposeObjectResources(gltf.scene);
    decodedTexture?.dispose();
  }
}

/** The exact buffers that a worker response must transfer to its caller. */
export function transferableAssetGeometryBuffers(
  decoded: AssetGeometryTransfer,
): ArrayBuffer[] {
  const buffers = new Set<ArrayBuffer>();
  for (const attribute of Object.values(decoded.attributes)) {
    const buffer = attribute.array.buffer;
    if (buffer instanceof ArrayBuffer) buffers.add(buffer);
  }
  if (decoded.baseColorTexture) {
    const buffer = decoded.baseColorTexture.pixels.buffer;
    if (buffer instanceof ArrayBuffer) buffers.add(buffer);
  }
  return [...buffers];
}
