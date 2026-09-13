import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import * as THREE from "three";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { TGALoader } from "three/addons/loaders/TGALoader.js";
import { transformedCatalogSourceBounds } from "./lib/catalog-source-bounds.mjs";

const inspectionPath =
  process.env.MUSHROOM_INSPECTION_PATH ??
  "docs/evidence/mushroom-candidate-inspection/report.json";
const evidenceDirectory =
  process.env.MUSHROOM_EVIDENCE_DIRECTORY ??
  "docs/evidence/mushroom-candidate-conversion";
const selectedFbxArchivePath = process.env.MUSHROOM_FBX_ARCHIVE_PATH;
const adaptiveBake = process.env.MUSHROOM_ADAPTIVE_BAKE === "1";
const conformingBake = process.env.MUSHROOM_CONFORMING_BAKE === "1";
const outputPath = join(evidenceDirectory, "prototype.glb");
const outputReportPath = join(evidenceDirectory, "report.json");
const outputLicensePath = join(evidenceDirectory, "License.txt");
const SUBDIVISION_LEVEL = 4;
const MAX_VERTICES = 30_000;
const MAX_BYTES = 2 * 1024 * 1024;
const CONFORMING_REFINEMENT_BUDGET = 18_000;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function asArrayBuffer(bytes) {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  );
}

function finiteArray(values) {
  return Array.from(values).every(Number.isFinite);
}

function wrappedIndex(index, size, wrapping) {
  if (wrapping === THREE.ClampToEdgeWrapping)
    return Math.max(0, Math.min(size - 1, index));
  if (wrapping === THREE.MirroredRepeatWrapping) {
    const period = size * 2;
    const wrapped = ((index % period) + period) % period;
    return wrapped < size ? wrapped : period - 1 - wrapped;
  }
  const wrapped = index % size;
  return wrapped < 0 ? wrapped + size : wrapped;
}

function srgbToLinear(value) {
  const srgb = value / 255;
  return srgb <= 0.04045
    ? srgb / 12.92
    : ((srgb + 0.055) / 1.055) ** 2.4;
}

function bilinearTextureSample(texture, uv) {
  const transformed = texture.transformUv(uv.clone());
  const { width, height, data } = texture.image;
  const x = transformed.x * width - 0.5;
  const y = transformed.y * height - 0.5;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const tx = x - x0;
  const ty = y - y0;
  const sample = (sampleX, sampleY) => {
    const wrappedX = wrappedIndex(sampleX, width, texture.wrapS);
    const wrappedY = wrappedIndex(sampleY, height, texture.wrapT);
    const offset = (wrappedY * width + wrappedX) * 4;
    return [
      srgbToLinear(data[offset]),
      srgbToLinear(data[offset + 1]),
      srgbToLinear(data[offset + 2]),
    ];
  };
  const topLeft = sample(x0, y0);
  const topRight = sample(x1, y0);
  const bottomLeft = sample(x0, y1);
  const bottomRight = sample(x1, y1);
  return topLeft.map((_, channel) => {
    const top = topLeft[channel] * (1 - tx) + topRight[channel] * tx;
    const bottom =
      bottomLeft[channel] * (1 - tx) + bottomRight[channel] * tx;
    return bottom * ty + top * (1 - ty);
  });
}

function interpolateVector(a, b, c, weights) {
  return a
    .clone()
    .multiplyScalar(weights[0])
    .addScaledVector(b, weights[1])
    .addScaledVector(c, weights[2]);
}

function glbJson(bytes) {
  const view = new DataView(asArrayBuffer(bytes));
  if (view.getUint32(0, true) !== 0x46546c67)
    throw new Error("Output is not a GLB file.");
  let offset = 12;
  while (offset < bytes.byteLength) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    if (type === 0x4e4f534a) {
      const text = new TextDecoder().decode(
        bytes.subarray(offset + 8, offset + 8 + length),
      );
      return JSON.parse(text.trim());
    }
    offset += 8 + length;
  }
  throw new Error("GLB JSON chunk is missing.");
}

function collectUris(value, result = []) {
  if (!value || typeof value !== "object") return result;
  if (Array.isArray(value)) {
    for (const item of value) collectUris(item, result);
    return result;
  }
  for (const [key, child] of Object.entries(value)) {
    if (key === "uri" && typeof child === "string") result.push(child);
    else collectUris(child, result);
  }
  return result;
}

function disposeScene(scene) {
  scene.traverse((object) => {
    if (!object.isMesh) return;
    object.geometry?.dispose();
    const materials = Array.isArray(object.material)
      ? object.material
      : object.material
        ? [object.material]
        : [];
    for (const material of materials) material.dispose?.();
  });
}

function sourceTriangle(
  mesh,
  triangleOffset,
  position,
  normal,
  uv,
  index,
  normalMatrix,
) {
  const readIndex = (corner) =>
    index ? index.getX(triangleOffset * 3 + corner) : triangleOffset * 3 + corner;
  const vertices = [0, 1, 2].map((corner) => {
    const vertexIndex = readIndex(corner);
    const point = new THREE.Vector3().fromBufferAttribute(position, vertexIndex);
    point.applyMatrix4(mesh.matrixWorld);
    const vertexNormal = normal
      ? new THREE.Vector3().fromBufferAttribute(normal, vertexIndex)
      : new THREE.Vector3(0, 1, 0);
    vertexNormal.applyMatrix3(normalMatrix).normalize();
    const vertexUv = new THREE.Vector2().fromBufferAttribute(uv, vertexIndex);
    return { point, normal: vertexNormal, uv: vertexUv };
  });
  return vertices;
}

const ADAPTIVE_ERROR_THRESHOLD = 0.04;
const ADAPTIVE_MAX_DEPTH = 4;
const ADAPTIVE_MAX_SPLITS = 2200;

function midpoint(a, b) {
  return a.map((value, index) => (value + b[index]) / 2);
}

function pointSegmentDistanceSquared(point, start, end) {
  const edge = end.clone().sub(start);
  const lengthSquared = edge.lengthSq();
  if (lengthSquared === 0)
    return { distanceSquared: point.distanceToSquared(start), t: 0 };
  const t = THREE.MathUtils.clamp(
    point.clone().sub(start).dot(edge) / lengthSquared,
    0,
    1,
  );
  return {
    distanceSquared: point.distanceToSquared(
      start.clone().addScaledVector(edge, t),
    ),
    t,
  };
}

function centroid(a, b, c) {
  return a.map((value, index) => (value + b[index] + c[index]) / 3);
}

function averageColor(a, b) {
  return a.map((value, index) => (value + b[index]) / 2);
}

function triangleSampleError(candidate, sampleColorAt) {
  const [a, b, c] = candidate.corners;
  const colors = [
    sampleColorAt(candidate.source, a),
    sampleColorAt(candidate.source, b),
    sampleColorAt(candidate.source, c),
  ];
  const samples = [
    [midpoint(a, b), averageColor(colors[0], colors[1])],
    [midpoint(b, c), averageColor(colors[1], colors[2])],
    [midpoint(c, a), averageColor(colors[2], colors[0])],
    [centroid(a, b, c), colors[0].map((_, index) => (colors[0][index] + colors[1][index] + colors[2][index]) / 3)],
  ];
  let maximum = 0;
  for (const [barycentric, predicted] of samples) {
    const actual = sampleColorAt(candidate.source, barycentric);
    for (let channel = 0; channel < 3; channel++)
      maximum = Math.max(maximum, Math.abs(actual[channel] - predicted[channel]));
  }
  return maximum;
}

function childTriangles(candidate) {
  const [a, b, c] = candidate.corners;
  const ab = midpoint(a, b);
  const bc = midpoint(b, c);
  const ca = midpoint(c, a);
  const depth = candidate.depth + 1;
  return [
    { source: candidate.source, corners: [a, ab, ca], depth },
    { source: candidate.source, corners: [ab, b, bc], depth },
    { source: candidate.source, corners: [ca, bc, c], depth },
    { source: candidate.source, corners: [ab, bc, ca], depth },
  ];
}

function barycentricPoint(source, barycentric, normalization) {
  return interpolateVector(
    source[0].point,
    source[1].point,
    source[2].point,
    barycentric,
  )
    .sub(normalization.center)
    .multiplyScalar(normalization.scale);
}

function conformTriangles(candidates, pointFor, tolerance = 1e-6) {
  const pointKey = (point) =>
    [point.x, point.y, point.z]
      .map((value) => Math.round(value / tolerance))
      .join(",");
  const points = new Map();
  for (const candidate of candidates) {
    for (const barycentric of candidate.corners) {
      const point = pointFor(candidate, barycentric);
      const key = pointKey(point);
      if (!points.has(key)) points.set(key, point);
    }
  }
  const edges = [];
  const spatialEdges = new Map();
  const cell = (value) => Math.floor(value / 0.01);
  const addSpatial = (x, y, z, edgeIndex) => {
    const key = `${x},${y},${z}`;
    const list = spatialEdges.get(key) ?? [];
    list.push(edgeIndex);
    spatialEdges.set(key, list);
  };
  const candidateEdges = candidates.map((candidate, candidateIndex) => {
    const result = [];
    for (let edgeIndex = 0; edgeIndex < 3; edgeIndex++) {
      const startBarycentric = candidate.corners[edgeIndex];
      const endBarycentric = candidate.corners[(edgeIndex + 1) % 3];
      const start = pointFor(candidate, startBarycentric);
      const end = pointFor(candidate, endBarycentric);
      const edge = {
        candidateIndex,
        edgeIndex,
        startBarycentric,
        endBarycentric,
        start,
        end,
        startKey: pointKey(start),
        endKey: pointKey(end),
        splits: [],
      };
      const edgeId = edges.length;
      edges.push(edge);
      result.push(edge);
      const min = start.clone().min(end);
      const max = start.clone().max(end);
      for (let x = cell(min.x); x <= cell(max.x); x++)
        for (let y = cell(min.y); y <= cell(max.y); y++)
          for (let z = cell(min.z); z <= cell(max.z); z++) addSpatial(x, y, z, edgeId);
    }
    return result;
  });
  const pointRecords = [...points.entries()];
  for (const [, point] of pointRecords) {
    const currentPointKey = pointKey(point);
    const x = cell(point.x);
    const y = cell(point.y);
    const z = cell(point.z);
    const candidateEdgesForPoint = new Set();
    for (let cellX = x - 1; cellX <= x + 1; cellX++)
      for (let cellY = y - 1; cellY <= y + 1; cellY++)
        for (let cellZ = z - 1; cellZ <= z + 1; cellZ++)
          for (const edgeIndex of spatialEdges.get(`${cellX},${cellY},${cellZ}`) ?? [])
            candidateEdgesForPoint.add(edgeIndex);
    for (const edgeIndex of candidateEdgesForPoint) {
      const edge = edges[edgeIndex];
      if (currentPointKey === edge.startKey || currentPointKey === edge.endKey)
        continue;
      const result = pointSegmentDistanceSquared(point, edge.start, edge.end);
      const length = edge.start.distanceTo(edge.end);
      const margin = Math.min(0.5, tolerance / Math.max(length, tolerance));
      if (result.t > margin && result.t < 1 - margin && result.distanceSquared <= tolerance ** 2)
        edge.splits.push(result.t);
    }
  }
  let splitTriangleCount = 0;
  const conformed = [];
  for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex++) {
    const candidate = candidates[candidateIndex];
    const edgesForCandidate = candidateEdges[candidateIndex];
    const boundary = [];
    let split = false;
    for (const edge of edgesForCandidate) {
      const uniqueT = [...new Set(edge.splits.map((value) => value.toPrecision(12)))]
        .map(Number)
        .sort((a, b) => a - b);
      if (uniqueT.length) split = true;
      boundary.push(edge.startBarycentric);
      for (const t of uniqueT)
        boundary.push(edge.startBarycentric.map((value, index) => value * (1 - t) + edge.endBarycentric[index] * t));
    }
    if (!split) {
      conformed.push(candidate);
      continue;
    }
    splitTriangleCount++;
    const center = centroid(...candidate.corners);
    for (let index = 0; index < boundary.length; index++)
      conformed.push({
        source: candidate.source,
        corners: [boundary[index], boundary[(index + 1) % boundary.length], center],
        depth: candidate.depth,
      });
  }
  return { triangles: conformed, splitTriangleCount };
}

function canonicalizePositions(output) {
  const representatives = new Map();
  for (let offset = 0; offset < output.positions.length; offset += 3) {
    const point = output.positions.slice(offset, offset + 3);
    const key = point.map((value) => Math.round(value / 1e-6)).join(",");
    const representative = representatives.get(key) ?? point;
    representatives.set(key, representative);
    output.positions[offset] = representative[0];
    output.positions[offset + 1] = representative[1];
    output.positions[offset + 2] = representative[2];
  }
}

function refineTriangles(initialTriangles, sampleColorAt, maxVertices = MAX_VERTICES) {
  const entries = initialTriangles.map((candidate) => ({
    candidate,
    error: triangleSampleError(candidate, sampleColorAt),
  }));
  const initialVertexCount = entries.length * 3;
  const maxSplits = Math.min(
    ADAPTIVE_MAX_SPLITS,
    Math.floor(Math.max(0, maxVertices - initialVertexCount) / 9),
  );
  const initialMaxSampledError = Math.max(
    0,
    ...entries.map((entry) => entry.error),
  );
  let refinementCount = 0;
  let budgetSaturation = false;
  let depthSaturation = false;
  while (true) {
    let candidateIndex = -1;
    let candidateError = ADAPTIVE_ERROR_THRESHOLD;
    for (let index = 0; index < entries.length; index++) {
      const entry = entries[index];
      if (
        entry.error > candidateError &&
        entry.candidate.depth < ADAPTIVE_MAX_DEPTH
      ) {
        candidateIndex = index;
        candidateError = entry.error;
      }
    }
    if (candidateIndex < 0) {
      depthSaturation = entries.some(
        (entry) =>
          entry.error > ADAPTIVE_ERROR_THRESHOLD &&
          entry.candidate.depth >= ADAPTIVE_MAX_DEPTH,
      );
      break;
    }
    if (
      refinementCount >= maxSplits ||
      entries.length * 3 + 9 > maxVertices
    ) {
      budgetSaturation = true;
      break;
    }
    const children = childTriangles(entries[candidateIndex].candidate).map(
      (child) => ({ candidate: child, error: triangleSampleError(child, sampleColorAt) }),
    );
    entries.splice(candidateIndex, 1, ...children);
    refinementCount++;
  }
  const triangles = entries.map((entry) => entry.candidate);
  return {
    triangles,
    initialTriangles: initialTriangles.length,
    finalTriangles: triangles.length,
    initialMaxSampledError,
    finalMaxSampledError: Math.max(0, ...entries.map((entry) => entry.error)),
    refinementCount,
    budgetSaturation,
    depthSaturation,
  };
}

function addBakedTriangle(
  output,
  triangle,
  barycentric,
  texture,
  materialColor,
  normalization,
  sampleColorAt,
) {
  const point = interpolateVector(
    triangle[0].point,
    triangle[1].point,
    triangle[2].point,
    barycentric,
  )
    .sub(normalization.center)
    .multiplyScalar(normalization.scale);
  const normal = interpolateVector(
    triangle[0].normal,
    triangle[1].normal,
    triangle[2].normal,
    barycentric,
  ).normalize();
  const uv = interpolateVector(
    triangle[0].uv,
    triangle[1].uv,
    triangle[2].uv,
    barycentric,
  );
  const color = sampleColorAt(triangle, barycentric);
  output.positions.push(point.x, point.y, point.z);
  output.normals.push(normal.x, normal.y, normal.z);
  output.colors.push(color[0], color[1], color[2]);
}

function bakeMesh(mesh, texture, material, adaptiveEnabled, conformingEnabled) {
  const position = mesh.geometry.getAttribute("position");
  const normal = mesh.geometry.getAttribute("normal");
  const uv = mesh.geometry.getAttribute("uv");
  if (!position || !uv)
    throw new Error("The selected mesh must contain positions and UVs.");
  const index = mesh.geometry.index;
  const triangleCount = (index?.count ?? position.count) / 3;
  if (!Number.isInteger(triangleCount))
    throw new Error(`Mesh triangle count is not integral: ${triangleCount}`);
  const materialColor = material.color
    ? [material.color.r, material.color.g, material.color.b]
    : [1, 1, 1];
  const sourceBounds = new THREE.Box3();
  const triangles = [];
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
  for (let triangleOffset = 0; triangleOffset < triangleCount; triangleOffset++) {
    const triangle = sourceTriangle(
      mesh,
      triangleOffset,
      position,
      normal,
      uv,
      index,
      normalMatrix,
    );
    for (const vertex of triangle) sourceBounds.expandByPoint(vertex.point);
    triangles.push(triangle);
  }
  const sourceHeight = sourceBounds.max.y - sourceBounds.min.y;
  if (!Number.isFinite(sourceHeight) || sourceHeight <= 0)
    throw new Error(`Source height is invalid: ${sourceHeight}`);
  const normalization = {
    center: new THREE.Vector3(
      (sourceBounds.min.x + sourceBounds.max.x) / 2,
      sourceBounds.min.y,
      (sourceBounds.min.z + sourceBounds.max.z) / 2,
    ),
    scale: 1 / sourceHeight,
  };
  const colorCache = new Map();
  const sampleColorAt = (triangle, barycentric) => {
    const key = `${triangle.id}:${barycentric.map((value) => value.toPrecision(12)).join(",")}`;
    const cached = colorCache.get(key);
    if (cached) return cached;
    const uvPoint = interpolateVector(
      triangle[0].uv,
      triangle[1].uv,
      triangle[2].uv,
      barycentric,
    );
    const sampled = bilinearTextureSample(texture, uvPoint).map(
      (channel, index) => channel * materialColor[index],
    );
    colorCache.set(key, sampled);
    return sampled;
  };
  const initialTriangles = [];
  const n = SUBDIVISION_LEVEL;
  triangles.forEach((triangle, triangleIndex) => {
    triangle.id = triangleIndex;
    const vertexAt = (i, j) => [i / n, j / n, 1 - (i + j) / n];
    const emit = (a, b, c) => {
      initialTriangles.push({
        source: triangle,
        corners: [vertexAt(...a), vertexAt(...b), vertexAt(...c)],
        depth: 0,
      });
    };
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n - i; j++) {
        emit([i, j], [i + 1, j], [i, j + 1]);
        if (j < n - i - 1)
          emit([i + 1, j], [i + 1, j + 1], [i, j + 1]);
      }
    }
  });
  const adaptive = adaptiveEnabled
    ? refineTriangles(
        initialTriangles,
        (triangle, barycentric) => sampleColorAt(triangle, barycentric),
        conformingEnabled ? CONFORMING_REFINEMENT_BUDGET : MAX_VERTICES,
      )
    : {
        triangles: initialTriangles,
        initialTriangles: initialTriangles.length,
        finalTriangles: initialTriangles.length,
        initialMaxSampledError: 0,
        finalMaxSampledError: 0,
        refinementCount: 0,
        budgetSaturation: false,
        depthSaturation: false,
      };
  const conforming = conformingEnabled
    ? conformTriangles(
        adaptive.triangles,
        (candidate, barycentric) =>
          barycentricPoint(candidate.source, barycentric, normalization),
      )
    : { triangles: adaptive.triangles, splitTriangleCount: 0 };
  const output = { positions: [], normals: [], colors: [] };
  for (const candidate of conforming.triangles) {
    for (const barycentric of candidate.corners)
      addBakedTriangle(
        output,
        candidate.source,
        barycentric,
        texture,
        materialColor,
        normalization,
        sampleColorAt,
      );
  }
  if (conformingEnabled) canonicalizePositions(output);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(output.positions, 3),
  );
  geometry.setAttribute(
    "normal",
    new THREE.Float32BufferAttribute(output.normals, 3),
  );
  geometry.setAttribute(
    "color",
    new THREE.Float32BufferAttribute(output.colors, 3),
  );
  return {
    geometry,
    sourceBounds,
    normalization,
    triangleCount,
    adaptive: {
      ...adaptive,
      finalTriangles: adaptive.triangles.length,
    },
    conforming: {
      enabled: conformingEnabled,
      finalTriangles: conforming.triangles.length,
      splitTriangleCount: conforming.splitTriangleCount,
      reservedRefinementVertices: conformingEnabled
        ? CONFORMING_REFINEMENT_BUDGET
        : null,
    },
  };
}

function runSamplerAssertions() {
  const texture = new THREE.DataTexture(
    new Uint8Array([
      255, 0, 0, 255,
      0, 255, 0, 255,
      0, 0, 255, 255,
      255, 255, 255, 255,
    ]),
    2,
    2,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.flipY = false;
  texture.updateMatrix();
  const center = bilinearTextureSample(texture, new THREE.Vector2(0.25, 0.25));
  const seam = bilinearTextureSample(texture, new THREE.Vector2(0, 0.25));
  const near = (actual, expected) =>
    actual.every((value, index) => Math.abs(value - expected[index]) < 1e-6);
  if (!near(center, [1, 0, 0]))
    throw new Error(`Sampler texel-center assertion failed: ${center}`);
  if (!near(seam, [0.5, 0.5, 0]))
    throw new Error(`Sampler repeat-seam assertion failed: ${seam}`);
  texture.dispose();
}

function runAdaptiveAssertions() {
  const source = { id: "synthetic" };
  const initial = [
    {
      source,
      corners: [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ],
      depth: 0,
    },
  ];
  const flat = refineTriangles(initial, () => [0.25, 0.25, 0.25], 30);
  if (flat.refinementCount !== 0)
    throw new Error("Adaptive flat-color assertion refined unexpectedly.");
  const contrast = refineTriangles(
    initial,
    (_, barycentric) => (barycentric[0] > 0.5 ? [1, 0, 0] : [0, 1, 0]),
    30,
  );
  if (contrast.refinementCount === 0 || contrast.finalTriangles > 10)
    throw new Error("Adaptive contrasting-boundary assertion failed.");
  const budget = refineTriangles(
    initial,
    (_, barycentric) => (barycentric[0] > 0.5 ? [1, 0, 0] : [0, 1, 0]),
    3,
  );
  if (budget.refinementCount !== 0 || !budget.budgetSaturation)
    throw new Error("Adaptive budget assertion failed.");
}

function runConformingAssertions() {
  const source = { id: "synthetic" };
  const midpointCorner = [0.5, 0.5, 0];
  const candidates = [
    { source, corners: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], depth: 0 },
    { source, corners: [[1, 0, 0], midpointCorner, [0, 0, 1]], depth: 0 },
    { source, corners: [midpointCorner, [0, 1, 0], [0, 0, 1]], depth: 0 },
  ];
  const pointFor = (_, barycentric) =>
    new THREE.Vector3(barycentric[0], barycentric[1], barycentric[2]);
  const result = conformTriangles(candidates, pointFor);
  if (result.splitTriangleCount === 0 || result.triangles.length <= candidates.length)
    throw new Error("Conforming neighbor split assertion failed.");
  for (const candidate of result.triangles) {
    const [a, b, c] = candidate.corners.map((corner) => pointFor(candidate, corner));
    if (b.clone().sub(a).cross(c.clone().sub(a)).lengthSq() === 0)
      throw new Error("Conforming neighbor split produced a zero-area triangle.");
  }
}

class NodeFileReader {
  constructor() {
    this.result = null;
    this.error = null;
    this.onloadend = null;
    this.onerror = null;
  }

  async readAsArrayBuffer(blob) {
    try {
      this.result = await blob.arrayBuffer();
      this.onloadend?.({ target: this });
    } catch (error) {
      this.error = error;
      this.onerror?.({ target: this });
    }
  }
}

async function main() {
  runSamplerAssertions();
  runAdaptiveAssertions();
  if (conformingBake) runConformingAssertions();
  await mkdir(evidenceDirectory, { recursive: true });
  const inspection = JSON.parse(await readFile(inspectionPath, "utf8"));
  const fbxEntries = inspection.selectedFiles.filter((entry) =>
    entry.archivePath.toLowerCase().endsWith(".fbx"),
  );
  const fbxEntry = selectedFbxArchivePath
    ? fbxEntries.find((entry) => entry.archivePath === selectedFbxArchivePath)
    : fbxEntries.length === 1
      ? fbxEntries[0]
      : fbxEntries.find(
          (entry) => entry.archivePath === "Meshes/Fly_Agaric_Big.fbx",
        );
  const tgaEntry = inspection.selectedFiles.find(
    (entry) => entry.archivePath === "Textures/Mushrooms_C.tga",
  );
  if (!fbxEntry || !tgaEntry)
    throw new Error("Inspection report does not contain selected FBX/TGA inputs.");
  const [fbxBytes, tgaBytes, licenseText] = await Promise.all([
    readFile(fbxEntry.path),
    readFile(tgaEntry.path),
    readFile(inspection.license.sourcePath, "utf8"),
  ]);
  const fbxSha256 = sha256(fbxBytes);
  const tgaSha256 = sha256(tgaBytes);
  const licenseSha256 = sha256(Buffer.from(licenseText));
  if (fbxSha256 !== fbxEntry.sha256)
    throw new Error(`FBX SHA-256 mismatch: ${fbxSha256}`);
  if (tgaSha256 !== tgaEntry.sha256)
    throw new Error(`TGA SHA-256 mismatch: ${tgaSha256}`);
  if (licenseSha256 !== inspection.license.licenseSha256)
    throw new Error(`License SHA-256 mismatch: ${licenseSha256}`);
  await writeFile(outputLicensePath, licenseText);

  const tgaData = new TGALoader().parse(asArrayBuffer(tgaBytes));
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
    setPath(path) {
      this.path = path;
      return this;
    },
    load(url, onLoad) {
      const basename = String(url).replaceAll("\\", "/").split("/").at(-1);
      if (basename !== "Mushrooms_C.tga")
        throw new Error(`Unexpected TGA request: ${url}`);
      onLoad?.(texture);
      return texture;
    },
  };
  const manager = new THREE.LoadingManager();
  manager.addHandler(/\.tga$/i, textureHandler);
  manager.setURLModifier((url) => {
    throw new Error(`Unexpected external resource request: ${url}`);
  });
  const scene = new FBXLoader(manager).parse(
    asArrayBuffer(fbxBytes),
    `${dirname(fbxEntry.path)}/`,
  );
  scene.updateMatrixWorld(true);
  const mesh = [];
  scene.traverse((object) => {
    if (object.isMesh) mesh.push(object);
  });
  if (mesh.length !== 1) throw new Error(`Expected one mesh, got ${mesh.length}.`);
  const sourceMesh = mesh[0];
  const material = Array.isArray(sourceMesh.material)
    ? sourceMesh.material[0]
    : sourceMesh.material;
  if (!material?.map || material.map !== texture)
    throw new Error("Selected FBX material does not use the prepared TGA map.");
  texture.updateMatrix();
  const baked = bakeMesh(
    sourceMesh,
    texture,
    material,
    adaptiveBake,
    conformingBake,
  );
  const bakedMesh = new THREE.Mesh(
    baked.geometry,
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.8,
      metalness: 0,
      vertexColors: true,
      name: "Fly_Agaric_Big_baked_vertex_colors",
    }),
  );
  bakedMesh.name = `${sourceMesh.name}_baked`;
  const bakedScene = new THREE.Scene();
  bakedScene.name = "Fly_Agaric_Big_baked_scene";
  bakedScene.add(bakedMesh);

  const vertexCount = baked.geometry.getAttribute("position").count;
  const triangleCount = vertexCount / 3;
  if (vertexCount > MAX_VERTICES) throw new Error(`Vertex cap exceeded: ${vertexCount}`);
  if (!Number.isInteger(triangleCount)) throw new Error("Output triangles are not integral.");
  if (typeof FileReader === "undefined") globalThis.FileReader = NodeFileReader;
  const glb = await new GLTFExporter().parseAsync(bakedScene, {
    binary: true,
    onlyVisible: true,
  });
  const glbBytes = new Uint8Array(glb);
  await writeFile(outputPath, glbBytes);
  if (glbBytes.byteLength > MAX_BYTES)
    throw new Error(`GLB byte cap exceeded: ${glbBytes.byteLength}`);

  const json = glbJson(glbBytes);
  const uris = collectUris(json);
  const hasImages = Array.isArray(json.images) && json.images.length > 0;
  const gltf = await new GLTFLoader().parseAsync(
    asArrayBuffer(glbBytes),
    "prototype.glb",
  );
  gltf.scene.updateMatrixWorld(true);
  const decodedMeshes = [];
  let finiteOutput = true;
  let minColor = [Infinity, Infinity, Infinity];
  let maxColor = [-Infinity, -Infinity, -Infinity];
  gltf.scene.traverse((object) => {
    if (!object.isMesh) return;
    const position = object.geometry.getAttribute("position");
    const normal = object.geometry.getAttribute("normal");
    const color = object.geometry.getAttribute("color");
    finiteOutput &&= !!position && !!normal && !!color;
    for (const attribute of [position, normal, color])
      if (attribute) finiteOutput &&= finiteArray(attribute.array);
    if (color) {
      for (let index = 0; index < color.count; index++) {
        for (let channel = 0; channel < 3; channel++) {
          const value = color.getComponent(index, channel);
          minColor[channel] = Math.min(minColor[channel], value);
          maxColor[channel] = Math.max(maxColor[channel], value);
          finiteOutput &&= value >= 0 && value <= 1;
        }
      }
    }
    decodedMeshes.push({
      name: object.name,
      vertices: position?.count ?? 0,
      triangles:
        (object.geometry.index?.count ?? position?.count ?? 0) / 3,
      attributes: Object.keys(object.geometry.attributes),
      hasMap: Array.isArray(object.material)
        ? object.material.some((entry) => !!entry.map)
        : !!object.material?.map,
    });
  });
  const transformedBounds = await transformedCatalogSourceBounds(
    glbBytes,
    "prototype.glb",
  );
  const outputBounds = transformedBounds.bounds;
  const minY = outputBounds.min[1];
  const outputHeight = outputBounds.size[1];
  finiteOutput &&= Math.abs(minY) <= 1e-6;
  finiteOutput &&= Math.abs(outputHeight - 1) <= 1e-5;
  if (!finiteOutput) throw new Error("Output GLB failed finite/range/bounds validation.");
  if (hasImages || uris.length) throw new Error("Output GLB contains image or URI resources.");

  const report = {
    status: "prototype-generated",
    scope: "offline texture-baked derivative; no catalog admission or visual fidelity claim",
    sourceInspection: inspectionPath,
    license: {
      spdx: inspection.license.license,
      creator: inspection.license.creator,
      url: inspection.license.licenseUrl,
      sourceTextPath: inspection.license.sourcePath,
      sourceTextSha256: licenseSha256,
      preservedTextPath: outputLicensePath,
    },
    inputs: {
      fbx: { path: fbxEntry.path, sha256: fbxSha256, bytes: fbxBytes.byteLength },
      tga: { path: tgaEntry.path, sha256: tgaSha256, bytes: tgaBytes.byteLength },
    },
    bake: {
      subdivisionPasses: 2,
      subdivisionLevel: SUBDIVISION_LEVEL,
      sourceTriangles: baked.triangleCount,
      outputTriangles: triangleCount,
      outputVertices: vertexCount,
      adaptive: {
        enabled: adaptiveBake,
        initialTriangles: baked.adaptive.initialTriangles,
        finalTriangles: baked.adaptive.finalTriangles,
        initialMaxSampledError: baked.adaptive.initialMaxSampledError,
        finalMaxSampledError: baked.adaptive.finalMaxSampledError,
        refinementCount: baked.adaptive.refinementCount,
        budgetSaturation: baked.adaptive.budgetSaturation,
        depthSaturation: baked.adaptive.depthSaturation,
        threshold: ADAPTIVE_ERROR_THRESHOLD,
        maxDepth: ADAPTIVE_MAX_DEPTH,
        maxSplits: ADAPTIVE_MAX_SPLITS,
        limitation: "Error is sampled only at edge midpoints and centroids; it is not a guarantee between samples.",
      },
      conforming: baked.conforming,
      textureSampling: {
        transform: "THREE.Texture.transformUv (repeat/offset/wrap/flipY)",
        filter: "bilinear",
        colorConversion: "sRGB bytes to linear float before bilinear interpolation",
        materialColorMultiplied: [material.color.r, material.color.g, material.color.b],
      },
    },
    normalization: {
      sourceBounds: {
        min: baked.sourceBounds.min.toArray(),
        max: baked.sourceBounds.max.toArray(),
        size: baked.sourceBounds.getSize(new THREE.Vector3()).toArray(),
      },
      sourceMatrixWorld: sourceMesh.matrixWorld.toArray(),
      applied: "source matrixWorld, then center X/Z, subtract source min Y, scale total height to 1 meter",
      sourceToOutputScale: baked.normalization.scale,
      outputUnits: "meters",
      outputBaseY: 0,
      outputHeight: 1,
    },
    output: {
      path: outputPath,
      bytes: glbBytes.byteLength,
      sha256: sha256(glbBytes),
      selfContained: true,
      hasImages,
      uris,
      meshes: decodedMeshes,
      bounds: outputBounds,
      colorRange: { min: minColor, max: maxColor },
    },
    checks: {
      finiteOutput,
      vertexLimit: `${vertexCount} <= ${MAX_VERTICES}`,
      byteLimit: `${glbBytes.byteLength} <= ${MAX_BYTES}`,
      baseY: Math.abs(minY) <= 1e-6,
      oneMeterHeight: Math.abs(outputHeight - 1) <= 1e-5,
      noImages: !hasImages,
      noExternalUris: uris.length === 0,
      decodedWithGLTFLoader: true,
      transformedBoundsHelper: true,
    },
    appearance: {
      status: "unverified",
      note: "No visual render was performed in this bounded conversion task.",
    },
  };
  await writeFile(outputReportPath, `${JSON.stringify(report, null, 2)}\n`);
  disposeScene(scene);
  disposeScene(bakedScene);
  texture.dispose();
  disposeScene(gltf.scene);
  console.log(JSON.stringify(report, null, 2));
}

try {
  await main();
} catch (error) {
  const report = {
    status: "error",
    scope: "offline texture-baked derivative; no catalog admission or visual fidelity claim",
    sourceInspection: inspectionPath,
    error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
  };
  await mkdir(evidenceDirectory, { recursive: true });
  await writeFile(outputReportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.error(JSON.stringify(report, null, 2));
  process.exitCode = 1;
}
