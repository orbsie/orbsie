import {
  BROWSER_MESH_EPSILON,
  BROWSER_MESH_INVALID_ERROR,
  validateBrowserMesh,
} from "./browser-mesh-validation";

export const MIN_BROWSER_TUBE_RADIUS = 1e-4;
export const MAX_BROWSER_TUBE_RADIUS = 50;
export const MAX_BROWSER_TUBE_PATH_POINTS = 63;
export const DEFAULT_BROWSER_TUBE_SEGMENTS = 16;
export const MAX_BROWSER_TUBE_SEGMENTS = 64;

type Vec3 = readonly [number, number, number];
type MutableVec3 = [number, number, number];
type Triangle = [number, number, number];

export interface BrowserTubeMesh {
  readonly vertices: Float32Array;
  readonly triangles: Uint32Array;
}

function invalid(): never {
  throw new Error(BROWSER_MESH_INVALID_ERROR);
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function subtract(a: Vec3, b: Vec3): MutableVec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a: Vec3, b: Vec3): MutableVec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function length(value: Vec3): number {
  return Math.sqrt(dot(value, value));
}

function normalize(value: Vec3): MutableVec3 {
  const magnitude = length(value);
  if (!Number.isFinite(magnitude) || magnitude <= BROWSER_MESH_EPSILON)
    invalid();
  return [value[0] / magnitude, value[1] / magnitude, value[2] / magnitude];
}

function addScaled(a: Vec3, b: Vec3, scale: number): MutableVec3 {
  return [a[0] + b[0] * scale, a[1] + b[1] * scale, a[2] + b[2] * scale];
}

function rotateAroundAxis(
  value: Vec3,
  axis: Vec3,
  sin: number,
  cos: number,
): MutableVec3 {
  const axisCross = cross(axis, value);
  const axisDot = dot(axis, value);
  return [
    value[0] * cos + axisCross[0] * sin + axis[0] * axisDot * (1 - cos),
    value[1] * cos + axisCross[1] * sin + axis[1] * axisDot * (1 - cos),
    value[2] * cos + axisCross[2] * sin + axis[2] * axisDot * (1 - cos),
  ];
}

function chooseInitialNormal(tangent: Vec3): MutableVec3 {
  const axes: Vec3[] = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  axes.sort(
    (first, second) =>
      Math.abs(dot(first, tangent)) - Math.abs(dot(second, tangent)),
  );
  const projection = tangent.map(
    (value) => value * dot(axes[0], tangent),
  ) as MutableVec3;
  return normalize(subtract(axes[0], projection));
}

function signedVolume(
  vertices: Float32Array,
  triangles: readonly Triangle[],
): number {
  let result = 0;
  for (const [aIndex, bIndex, cIndex] of triangles) {
    const a: Vec3 = [
      vertices[aIndex * 3],
      vertices[aIndex * 3 + 1],
      vertices[aIndex * 3 + 2],
    ];
    const b: Vec3 = [
      vertices[bIndex * 3],
      vertices[bIndex * 3 + 1],
      vertices[bIndex * 3 + 2],
    ];
    const c: Vec3 = [
      vertices[cIndex * 3],
      vertices[cIndex * 3 + 1],
      vertices[cIndex * 3 + 2],
    ];
    result += dot(a, cross(b, c)) / 6;
  }
  return result;
}

function reverseWinding(triangles: Triangle[]): void {
  for (const triangle of triangles)
    [triangle[1], triangle[2]] = [triangle[2], triangle[1]];
}

export function browserTubeMeshCounts(pathPoints: number, segments: number) {
  return {
    vertices: pathPoints * segments + 2,
    triangles: pathPoints * segments * 2,
  };
}

export function validateBrowserTube(
  pathInput: readonly (readonly [number, number, number])[],
  radius: number,
  segments: number,
): BrowserTubeMesh {
  if (
    pathInput.length < 2 ||
    pathInput.length > MAX_BROWSER_TUBE_PATH_POINTS ||
    !Number.isFinite(radius) ||
    radius <= MIN_BROWSER_TUBE_RADIUS ||
    radius > MAX_BROWSER_TUBE_RADIUS ||
    !Number.isInteger(segments) ||
    segments < 3 ||
    segments > MAX_BROWSER_TUBE_SEGMENTS
  )
    invalid();

  const path = pathInput.map((source) => {
    if (!Array.isArray(source) || source.length !== 3) invalid();
    const point: MutableVec3 = [
      Math.fround(source[0]),
      Math.fround(source[1]),
      Math.fround(source[2]),
    ];
    if (point.some((value) => !Number.isFinite(value) || Math.abs(value) > 100))
      invalid();
    return point;
  });
  const pointKeys = new Set<string>();
  for (const point of path) {
    const key = point.join(",");
    if (pointKeys.has(key)) invalid();
    pointKeys.add(key);
  }

  const segmentTangents: MutableVec3[] = [];
  for (let index = 0; index < path.length - 1; index += 1) {
    const segment = normalize(subtract(path[index + 1], path[index]));
    segmentTangents.push(segment);
  }
  for (let index = 0; index < segmentTangents.length - 1; index += 1) {
    if (dot(segmentTangents[index], segmentTangents[index + 1]) <= -1 + 1e-5)
      invalid();
  }

  const tangents: MutableVec3[] = path.map((_, index) => {
    if (index === 0) return [...segmentTangents[0]];
    if (index === path.length - 1) return [...segmentTangents.at(-1)!];
    return normalize(
      addScaled(segmentTangents[index - 1], segmentTangents[index], 1),
    );
  });
  const normals: MutableVec3[] = [chooseInitialNormal(tangents[0])];
  const binormals: MutableVec3[] = [normalize(cross(tangents[0], normals[0]))];
  for (let index = 1; index < path.length; index += 1) {
    const previousTangent = tangents[index - 1];
    const tangent = tangents[index];
    const axis = cross(previousTangent, tangent);
    const sin = length(axis);
    const cos = Math.max(-1, Math.min(1, dot(previousTangent, tangent)));
    if (sin <= BROWSER_MESH_EPSILON) {
      if (cos < 0) invalid();
      normals.push([...normals[index - 1]]);
    } else {
      const transported = rotateAroundAxis(
        normals[index - 1],
        normalize(axis),
        sin,
        cos,
      );
      const projected = subtract(
        transported,
        tangent.map(
          (value) => value * dot(transported, tangent),
        ) as MutableVec3,
      );
      normals.push(normalize(projected));
    }
    binormals.push(normalize(cross(tangent, normals[index])));
  }

  const counts = browserTubeMeshCounts(path.length, segments);
  const vertices = new Float32Array(counts.vertices * 3);
  const triangles: Triangle[] = [];
  const ringIndex = (pathIndex: number, segmentIndex: number) =>
    pathIndex * segments + segmentIndex;
  const writeVertex = (index: number, point: Vec3) => {
    if (point.some((value) => !Number.isFinite(value) || Math.abs(value) > 100))
      invalid();
    vertices.set(point.map(Math.fround), index * 3);
  };
  for (let pathIndex = 0; pathIndex < path.length; pathIndex += 1) {
    for (let segmentIndex = 0; segmentIndex < segments; segmentIndex += 1) {
      const angle = (2 * Math.PI * segmentIndex) / segments;
      const radial: Vec3 = [
        normals[pathIndex][0] * Math.cos(angle) +
          binormals[pathIndex][0] * Math.sin(angle),
        normals[pathIndex][1] * Math.cos(angle) +
          binormals[pathIndex][1] * Math.sin(angle),
        normals[pathIndex][2] * Math.cos(angle) +
          binormals[pathIndex][2] * Math.sin(angle),
      ];
      writeVertex(
        ringIndex(pathIndex, segmentIndex),
        addScaled(path[pathIndex], radial, radius),
      );
    }
  }
  const startCenter = counts.vertices - 2;
  const endCenter = counts.vertices - 1;
  writeVertex(startCenter, path[0]);
  writeVertex(endCenter, path.at(-1)!);

  for (let pathIndex = 0; pathIndex < path.length - 1; pathIndex += 1) {
    for (let segmentIndex = 0; segmentIndex < segments; segmentIndex += 1) {
      const next = (segmentIndex + 1) % segments;
      const a = ringIndex(pathIndex, segmentIndex);
      const b = ringIndex(pathIndex, next);
      const c = ringIndex(pathIndex + 1, next);
      const d = ringIndex(pathIndex + 1, segmentIndex);
      triangles.push([a, b, c], [a, c, d]);
    }
  }
  for (let segmentIndex = 0; segmentIndex < segments; segmentIndex += 1) {
    const next = (segmentIndex + 1) % segments;
    triangles.push(
      [startCenter, ringIndex(0, next), ringIndex(0, segmentIndex)],
      [
        endCenter,
        ringIndex(path.length - 1, segmentIndex),
        ringIndex(path.length - 1, next),
      ],
    );
  }
  if (signedVolume(vertices, triangles) < 0) reverseWinding(triangles);
  const validated = validateBrowserMesh(
    Array.from(
      { length: counts.vertices },
      (_, index) =>
        [
          vertices[index * 3],
          vertices[index * 3 + 1],
          vertices[index * 3 + 2],
        ] as [number, number, number],
    ),
    triangles,
  );
  return { vertices: validated.vertices, triangles: validated.triangles };
}
