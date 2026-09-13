import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import * as THREE from "three";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { TGALoader } from "three/addons/loaders/TGALoader.js";

const inspectionPath =
  process.env.MUSHROOM_TOPOLOGY_INSPECTION_PATH ??
  "docs/evidence/mushroom-basic-inspection/report.json";
const uniformReportPath =
  process.env.MUSHROOM_TOPOLOGY_UNIFORM_REPORT_PATH ??
  "docs/evidence/mushroom-basic-conversion/report.json";
const adaptiveReportPath =
  process.env.MUSHROOM_TOPOLOGY_ADAPTIVE_REPORT_PATH ??
  "docs/evidence/mushroom-basic-adaptive-conversion/report.json";
const conformingReportPath = process.env.MUSHROOM_TOPOLOGY_CONFORMING_REPORT_PATH;
const outputDirectory =
  process.env.MUSHROOM_TOPOLOGY_OUTPUT_DIRECTORY ??
  "docs/evidence/mushroom-topology-diagnosis";
const outputReportPath = `${outputDirectory}/report.json`;
const TOLERANCE = 1e-6;
const GRID_SIZE = 0.01;
const SMALL_AREA_THRESHOLD_M2 = 1e-6;

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

function disposeScene(scene) {
  scene.traverse((object) => {
    if (!object.isMesh) return;
    object.geometry.dispose();
    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material];
    for (const material of materials) material.dispose?.();
  });
}

function keyForPoint(point) {
  return point.map((value) => Math.round(value / TOLERANCE)).join(",");
}

function gridKey(x, y, z) {
  return `${Math.floor(x / GRID_SIZE)},${Math.floor(y / GRID_SIZE)},${Math.floor(z / GRID_SIZE)}`;
}

function edgeKey(a, b) {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function pointSegmentDistanceSquared(point, start, end) {
  const edge = end.clone().sub(start);
  const lengthSquared = edge.lengthSq();
  if (lengthSquared === 0) return { distanceSquared: point.distanceToSquared(start), t: 0 };
  const t = THREE.MathUtils.clamp(point.clone().sub(start).dot(edge) / lengthSquared, 0, 1);
  return { distanceSquared: point.distanceToSquared(start.clone().addScaledVector(edge, t)), t };
}

function analyzeGeometry(name, geometry) {
  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  if (!position) throw new Error(`${name} has no positions.`);
  const rawBounds = new THREE.Box3().setFromBufferAttribute(position);
  const rawHeight = rawBounds.max.y - rawBounds.min.y;
  if (!Number.isFinite(rawHeight) || rawHeight <= 0)
    throw new Error(`${name} has invalid height: ${rawHeight}`);
  const normalizedCenter = new THREE.Vector3(
    (rawBounds.min.x + rawBounds.max.x) / 2,
    rawBounds.min.y,
    (rawBounds.min.z + rawBounds.max.z) / 2,
  );
  const normalizedScale = 1 / rawHeight;
  const vertexPoints = [];
  const vertexIds = [];
  const welded = new Map();
  for (let index = 0; index < position.count; index++) {
    const point = new THREE.Vector3()
      .fromBufferAttribute(position, index)
      .sub(normalizedCenter)
      .multiplyScalar(normalizedScale);
    const key = keyForPoint(point.toArray());
    let id = welded.get(key);
    if (id === undefined) {
      id = vertexPoints.length;
      welded.set(key, id);
      vertexPoints.push(point);
    }
    vertexIds.push(id);
  }
  const triangleCount = (geometry.index?.count ?? position.count) / 3;
  const triangles = [];
  let minArea = Infinity;
  let exactZeroAreaCount = 0;
  let smallAreaCount = 0;
  let invertedWindingCount = 0;
  let minWindingDot = Infinity;
  let maxWindingDot = -Infinity;
  let finite = finiteArray(position.array);
  if (normal) finite &&= finiteArray(normal.array);
  const faceA = new THREE.Vector3();
  const faceB = new THREE.Vector3();
  const faceNormal = new THREE.Vector3();
  for (let triangle = 0; triangle < triangleCount; triangle++) {
    const offsets = [0, 1, 2].map((corner) => {
      const offset = triangle * 3 + corner;
      return geometry.index ? geometry.index.getX(offset) : offset;
    });
    const [a, b, c] = offsets.map((offset) =>
      new THREE.Vector3()
        .fromBufferAttribute(position, offset)
        .sub(normalizedCenter)
        .multiplyScalar(normalizedScale),
    );
    faceA.subVectors(b, a);
    faceB.subVectors(c, a);
    faceNormal.crossVectors(faceA, faceB);
    const area = faceNormal.length() / 2;
    minArea = Math.min(minArea, area);
    if (area === 0) exactZeroAreaCount++;
    if (area <= SMALL_AREA_THRESHOLD_M2) smallAreaCount++;
    let windingDot = null;
    if (normal) {
      const interpolated = new THREE.Vector3();
      for (const offset of offsets)
        interpolated.add(new THREE.Vector3().fromBufferAttribute(normal, offset));
      interpolated.normalize();
      windingDot = faceNormal.normalize().dot(interpolated);
      minWindingDot = Math.min(minWindingDot, windingDot);
      maxWindingDot = Math.max(maxWindingDot, windingDot);
      if (windingDot < 0) invertedWindingCount++;
    }
    triangles.push([vertexIds[offsets[0]], vertexIds[offsets[1]], vertexIds[offsets[2]]]);
  }

  const edges = new Map();
  for (const [a, b, c] of triangles) {
    for (const [start, end] of [[a, b], [b, c], [c, a]]) {
      const key = edgeKey(start, end);
      const edge = edges.get(key) ?? { start: vertexPoints[start], end: vertexPoints[end], incidence: 0 };
      edge.incidence++;
      edges.set(key, edge);
    }
  }
  const incidenceHistogram = {};
  for (const edge of edges.values())
    incidenceHistogram[edge.incidence] = (incidenceHistogram[edge.incidence] ?? 0) + 1;

  const spatialEdges = new Map();
  for (const [key, edge] of edges) {
    const min = edge.start.clone().min(edge.end);
    const max = edge.start.clone().max(edge.end);
    for (let x = Math.floor(min.x / GRID_SIZE); x <= Math.floor(max.x / GRID_SIZE); x++)
      for (let y = Math.floor(min.y / GRID_SIZE); y <= Math.floor(max.y / GRID_SIZE); y++)
        for (let z = Math.floor(min.z / GRID_SIZE); z <= Math.floor(max.z / GRID_SIZE); z++) {
          const cell = `${x},${y},${z}`;
          const list = spatialEdges.get(cell) ?? [];
          list.push(key);
          spatialEdges.set(cell, list);
        }
  }
  let tJunctionCount = 0;
  const tJunctionExamples = [];
  const checked = new Set();
  for (let vertexId = 0; vertexId < vertexPoints.length; vertexId++) {
    const point = vertexPoints[vertexId];
    const cellX = Math.floor(point.x / GRID_SIZE);
    const cellY = Math.floor(point.y / GRID_SIZE);
    const cellZ = Math.floor(point.z / GRID_SIZE);
    const candidates = new Set();
    for (let x = cellX - 1; x <= cellX + 1; x++)
      for (let y = cellY - 1; y <= cellY + 1; y++)
        for (let z = cellZ - 1; z <= cellZ + 1; z++)
          for (const key of spatialEdges.get(`${x},${y},${z}`) ?? []) candidates.add(key);
    for (const key of candidates) {
      const edge = edges.get(key);
      const endpointKey = `${vertexId}|${key}`;
      if (checked.has(endpointKey)) continue;
      checked.add(endpointKey);
      const edgeEndpoints = key.split(":").map(Number);
      if (edgeEndpoints.includes(vertexId)) continue;
      const result = pointSegmentDistanceSquared(point, edge.start, edge.end);
      const length = edge.start.distanceTo(edge.end);
      const endpointMargin = Math.min(0.5, TOLERANCE / Math.max(length, TOLERANCE));
      if (result.t > endpointMargin && result.t < 1 - endpointMargin && result.distanceSquared <= TOLERANCE ** 2) {
        tJunctionCount++;
        if (tJunctionExamples.length < 8)
          tJunctionExamples.push({ vertexId, edge: edgeEndpoints, distance: Math.sqrt(result.distanceSquared), t: result.t });
      }
    }
  }
  return {
    name,
    vertices: position.count,
    weldedVertices: vertexPoints.length,
    triangles: triangleCount,
    finite,
    minTriangleAreaM2: minArea,
    exactZeroAreaCount,
    smallAreaCount,
    smallAreaThresholdM2: SMALL_AREA_THRESHOLD_M2,
    winding: {
      minFaceNormalDotInterpolatedNormal: minWindingDot,
      maxFaceNormalDotInterpolatedNormal: maxWindingDot,
      invertedWindingCount,
    },
    normals: normal
      ? {
          finite: finiteArray(normal.array),
          minLength: Math.min(...Array.from({ length: normal.count }, (_, index) => new THREE.Vector3().fromBufferAttribute(normal, index).length())),
          maxLength: Math.max(...Array.from({ length: normal.count }, (_, index) => new THREE.Vector3().fromBufferAttribute(normal, index).length())),
        }
      : null,
    weldedEdgeIncidence: { uniqueEdges: edges.size, histogram: incidenceHistogram },
    tJunctions: {
      tolerance: TOLERANCE,
      gridCellSize: GRID_SIZE,
      count: tJunctionCount,
      examples: tJunctionExamples,
      completeSpatialCheck: true,
    },
  };
}

async function main() {
  await mkdir(outputDirectory, { recursive: true });
  const inspection = JSON.parse(await readFile(inspectionPath, "utf8"));
  const uniform = JSON.parse(await readFile(uniformReportPath, "utf8"));
  const adaptive = JSON.parse(await readFile(adaptiveReportPath, "utf8"));
  const conforming = conformingReportPath
    ? JSON.parse(await readFile(conformingReportPath, "utf8"))
    : null;
  const fbxEntry = inspection.selectedFiles.find((entry) => entry.archivePath.endsWith("Basic.fbx"));
  if (!fbxEntry) throw new Error("Basic FBX inspection entry is missing.");
  const artifactReports = [uniform, adaptive, ...(conforming ? [conforming] : [])];
  const artifactBytes = await Promise.all(
    artifactReports.map((report) => readFile(report.output.path)),
  );
  const [fbxBytes, tgaBytes] = await Promise.all([
    readFile(fbxEntry.path),
    readFile(inspection.selectedFiles.find((entry) => entry.archivePath.endsWith("Mushrooms_C.tga")).path),
  ]);
  const [uniformBytes, adaptiveBytes, conformingBytes] = artifactBytes;
  const hashes = {
    fbx: sha256(fbxBytes),
    uniformGlb: sha256(uniformBytes),
    adaptiveGlb: sha256(adaptiveBytes),
    tga: sha256(tgaBytes),
    ...(conforming ? { conformingGlb: sha256(conformingBytes) } : {}),
  };
  const textureData = new TGALoader().parse(asArrayBuffer(tgaBytes));
  const texture = new THREE.DataTexture(textureData.data, textureData.width, textureData.height, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.flipY = textureData.flipY ?? false;
  const handler = {
    path: "",
    setPath(path) { this.path = path; return this; },
    load(url, onLoad) {
      if (String(url).replaceAll("\\", "/").split("/").at(-1) !== "Mushrooms_C.tga") throw new Error(`Unexpected texture: ${url}`);
      onLoad?.(texture); return texture;
    },
  };
  const manager = new THREE.LoadingManager();
  manager.addHandler(/\.tga$/i, handler);
  manager.setURLModifier((url) => { throw new Error(`Unexpected external resource: ${url}`); });
  const fbxScene = new FBXLoader(manager).parse(asArrayBuffer(fbxBytes), `${fbxEntry.path.slice(0, fbxEntry.path.lastIndexOf("/") + 1)}`);
  fbxScene.updateMatrixWorld(true);
  let fbxGeometry;
  fbxScene.traverse((object) => { if (object.isMesh) fbxGeometry = object.geometry; });
  if (!fbxGeometry) throw new Error("Basic FBX contains no mesh.");
  const loadGlbGeometry = async (bytes) => {
    const gltf = await new GLTFLoader().parseAsync(asArrayBuffer(bytes), "prototype.glb");
    gltf.scene.updateMatrixWorld(true);
    let geometry;
    gltf.scene.traverse((object) => { if (object.isMesh) geometry = object.geometry; });
    if (!geometry) throw new Error("GLB contains no mesh.");
    return { scene: gltf.scene, geometry };
  };
  const uniformLoaded = await loadGlbGeometry(uniformBytes);
  const adaptiveLoaded = await loadGlbGeometry(adaptiveBytes);
  const analyses = [
    analyzeGeometry("basic-fbx", fbxGeometry),
    analyzeGeometry("basic-uniform-glb", uniformLoaded.geometry),
    analyzeGeometry("basic-adaptive-glb", adaptiveLoaded.geometry),
  ];
  let conformingLoaded;
  if (conforming) {
    conformingLoaded = await loadGlbGeometry(conformingBytes);
    analyses.push(
      analyzeGeometry("basic-conforming-glb", conformingLoaded.geometry),
    );
  }
  const report = {
    status: "diagnosed",
    scope: "offline topology measurements; does not establish rendered causality",
    inputs: {
      inspection: inspectionPath,
      fbx: { path: fbxEntry.path, bytes: fbxBytes.byteLength, sha256: hashes.fbx },
      tga: { bytes: tgaBytes.byteLength, sha256: hashes.tga },
      uniformGlb: { path: uniform.output.path, bytes: uniformBytes.byteLength, sha256: hashes.uniformGlb },
      adaptiveGlb: { path: adaptive.output.path, bytes: adaptiveBytes.byteLength, sha256: hashes.adaptiveGlb },
      ...(conforming
        ? { conformingGlb: { path: conforming.output.path, bytes: conformingBytes.byteLength, sha256: hashes.conformingGlb } }
        : {}),
    },
    sampler: {
      tolerance: TOLERANCE,
      gridCellSize: GRID_SIZE,
      textureWidth: textureData.width,
      textureHeight: textureData.height,
      geometryComparisonSpace: "each geometry normalized to unit height and centered X/Z before area/weld/spatial checks",
      areaUnits: "normalized square meters",
    },
    analyses,
    comparison: {
      uniformTriangles: analyses[1].triangles,
      adaptiveTriangles: analyses[2].triangles,
      adaptiveExtraTriangles: analyses[2].triangles - analyses[1].triangles,
      adaptiveTjunctions: analyses[2].tJunctions.count,
      uniformTjunctions: analyses[1].tJunctions.count,
      ...(conforming
        ? {
            conformingTriangles: analyses[3].triangles,
            conformingTjunctions: analyses[3].tJunctions.count,
          }
        : {}),
      interpretation: "T-junction and edge-incidence measurements can indicate refinement topology discontinuities, but they do not by themselves prove the SwiftShader pink speckles are caused by raster cracks.",
    },
  };
  await writeFile(outputReportPath, `${JSON.stringify(report, null, 2)}\n`);
  disposeScene(fbxScene); disposeScene(uniformLoaded.scene); disposeScene(adaptiveLoaded.scene); if (conformingLoaded) disposeScene(conformingLoaded.scene); texture.dispose();
  console.log(JSON.stringify(report, null, 2));
}

try { await main(); } catch (error) {
  const report = { status: "error", scope: "offline topology measurements; does not establish rendered causality", error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) };
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(outputReportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.error(JSON.stringify(report, null, 2));
  process.exitCode = 1;
}
