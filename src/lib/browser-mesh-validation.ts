export const MAX_BROWSER_MESH_VERTICES = 4096;
export const MAX_BROWSER_MESH_TRIANGLES = 8192;
export const MAX_BROWSER_MESH_RECIPE_VERTICES = 8192;
export const MAX_BROWSER_MESH_RECIPE_TRIANGLES = 16384;

/** Tolerance used after converting recipe coordinates to Float32. */
export const BROWSER_MESH_EPSILON = 1e-6;
const MIN_SIGNED_VOLUME = BROWSER_MESH_EPSILON ** 3;
const GRID_AXIS = 16;
const MAX_GRID_ASSIGNMENTS = 500_000;
const MAX_INTERSECTION_CANDIDATES = 250_000;
const MAX_INTERSECTION_PAIR_VISITS = 500_000;
export const BROWSER_MESH_INVALID_ERROR = "Browser mesh is invalid.";

export class BrowserMeshValidationBudgetError extends Error {
  readonly code = "BROWSER_MESH_VALIDATION_BUDGET";

  constructor() {
    super("Browser mesh validation budget exhausted.");
    this.name = "BrowserMeshValidationBudgetError";
  }
}

type Vec3 = readonly [number, number, number];
type Triangle = readonly [number, number, number];
type Point2 = readonly [number, number];

interface TriangleGeometry {
  readonly indices: Triangle;
  readonly points: readonly [Vec3, Vec3, Vec3];
  readonly min: Vec3;
  readonly max: Vec3;
}

interface EdgeUse {
  readonly from: number;
  readonly to: number;
  readonly triangle: number;
}

export interface ValidatedBrowserMesh {
  readonly vertices: Float32Array;
  readonly triangles: Uint32Array;
}

function invalid(): never {
  throw new Error(BROWSER_MESH_INVALID_ERROR);
}

function failWork(): never {
  throw new BrowserMeshValidationBudgetError();
}

function subtract(a: Vec3, b: Vec3): [number, number, number] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross3(a: Vec3, b: Vec3): [number, number, number] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function lengthSquared(value: Vec3): number {
  return dot(value, value);
}

function distanceSquared(a: Vec3, b: Vec3): number {
  return lengthSquared(subtract(a, b));
}

function pointOnSegment(point: Vec3, a: Vec3, b: Vec3): boolean {
  const edge = subtract(b, a);
  const edgeLength = lengthSquared(edge);
  if (edgeLength <= BROWSER_MESH_EPSILON ** 2) return false;
  const from = subtract(point, a);
  const t = dot(from, edge) / edgeLength;
  if (t < -BROWSER_MESH_EPSILON || t > 1 + BROWSER_MESH_EPSILON) return false;
  return (
    distanceSquared(point, [
      a[0] + edge[0] * Math.max(0, Math.min(1, t)),
      a[1] + edge[1] * Math.max(0, Math.min(1, t)),
      a[2] + edge[2] * Math.max(0, Math.min(1, t)),
    ]) <=
    BROWSER_MESH_EPSILON ** 2
  );
}

function pointInTriangle(point: Vec3, triangle: TriangleGeometry): boolean {
  const [a, b, c] = triangle.points;
  const edges = [subtract(b, a), subtract(c, b), subtract(a, c)] as const;
  const normal = cross3(edges[0], subtract(c, a));
  const normalLength = Math.sqrt(lengthSquared(normal));
  if (normalLength === 0) return false;
  if (
    Math.abs(dot(normal, subtract(point, a))) >
    BROWSER_MESH_EPSILON * normalLength
  )
    return false;
  const sides = [
    dot(cross3(edges[0], subtract(point, a)), normal) / normalLength,
    dot(cross3(edges[1], subtract(point, b)), normal) / normalLength,
    dot(cross3(edges[2], subtract(point, c)), normal) / normalLength,
  ];
  return sides.every(
    (side, index) =>
      side >= -BROWSER_MESH_EPSILON * Math.sqrt(lengthSquared(edges[index])),
  );
}

function project(point: Vec3, dropAxis: number): Point2 {
  if (dropAxis === 0) return [point[1], point[2]];
  if (dropAxis === 1) return [point[0], point[2]];
  return [point[0], point[1]];
}

function cross2(a: Point2, b: Point2, c: Point2): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function pointOnSegment2(point: Point2, a: Point2, b: Point2): boolean {
  const edgeLength = Math.hypot(b[0] - a[0], b[1] - a[1]);
  return (
    Math.abs(cross2(a, b, point)) <= BROWSER_MESH_EPSILON * edgeLength &&
    point[0] >= Math.min(a[0], b[0]) - BROWSER_MESH_EPSILON &&
    point[0] <= Math.max(a[0], b[0]) + BROWSER_MESH_EPSILON &&
    point[1] >= Math.min(a[1], b[1]) - BROWSER_MESH_EPSILON &&
    point[1] <= Math.max(a[1], b[1]) + BROWSER_MESH_EPSILON
  );
}

function pointInTriangle2(
  point: Point2,
  triangle: readonly [Point2, Point2, Point2],
): boolean {
  const signs = [
    cross2(triangle[0], triangle[1], point),
    cross2(triangle[1], triangle[2], point),
    cross2(triangle[2], triangle[0], point),
  ];
  const edgeLengths = [
    Math.hypot(
      triangle[1][0] - triangle[0][0],
      triangle[1][1] - triangle[0][1],
    ),
    Math.hypot(
      triangle[2][0] - triangle[1][0],
      triangle[2][1] - triangle[1][1],
    ),
    Math.hypot(
      triangle[0][0] - triangle[2][0],
      triangle[0][1] - triangle[2][1],
    ),
  ];
  const tolerances = edgeLengths.map((length) => BROWSER_MESH_EPSILON * length);
  return (
    signs.every((sign, index) => sign <= tolerances[index]) ||
    signs.every((sign, index) => sign >= -tolerances[index])
  );
}

function addUnique(points: Vec3[], point: Vec3): void {
  if (
    !points.some(
      (existing) =>
        distanceSquared(existing, point) <= BROWSER_MESH_EPSILON ** 2,
    )
  )
    points.push(point);
}

function coplanarIntersections(
  first: TriangleGeometry,
  second: TriangleGeometry,
  dropAxis: number,
): Vec3[] {
  const first2 = first.points.map((point) => project(point, dropAxis)) as [
    Point2,
    Point2,
    Point2,
  ];
  const second2 = second.points.map((point) => project(point, dropAxis)) as [
    Point2,
    Point2,
    Point2,
  ];
  const points: Vec3[] = [];
  for (let firstEdge = 0; firstEdge < 3; firstEdge += 1) {
    const firstNext = (firstEdge + 1) % 3;
    for (let secondEdge = 0; secondEdge < 3; secondEdge += 1) {
      const secondNext = (secondEdge + 1) % 3;
      const a = first2[firstEdge];
      const b = first2[firstNext];
      const c = second2[secondEdge];
      const d = second2[secondNext];
      const denominator =
        (b[0] - a[0]) * (d[1] - c[1]) - (b[1] - a[1]) * (d[0] - c[0]);
      const denominatorTolerance =
        BROWSER_MESH_EPSILON *
        Math.max(
          Math.hypot(b[0] - a[0], b[1] - a[1]),
          Math.hypot(d[0] - c[0], d[1] - c[1]),
        );
      if (Math.abs(denominator) > denominatorTolerance) {
        const numerator =
          (c[0] - a[0]) * (d[1] - c[1]) - (c[1] - a[1]) * (d[0] - c[0]);
        const otherNumerator =
          (c[0] - a[0]) * (b[1] - a[1]) - (c[1] - a[1]) * (b[0] - a[0]);
        const t = numerator / denominator;
        const u = otherNumerator / denominator;
        if (
          t >= -BROWSER_MESH_EPSILON &&
          t <= 1 + BROWSER_MESH_EPSILON &&
          u >= -BROWSER_MESH_EPSILON &&
          u <= 1 + BROWSER_MESH_EPSILON
        ) {
          const point: Vec3 = [
            first.points[firstEdge][0] +
              (first.points[firstNext][0] - first.points[firstEdge][0]) * t,
            first.points[firstEdge][1] +
              (first.points[firstNext][1] - first.points[firstEdge][1]) * t,
            first.points[firstEdge][2] +
              (first.points[firstNext][2] - first.points[firstEdge][2]) * t,
          ];
          addUnique(points, point);
        }
      } else {
        for (const point of [a, b]) {
          if (pointOnSegment2(point, c, d)) {
            const t =
              Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1])
                ? (point[0] - a[0]) / (b[0] - a[0] || 1)
                : (point[1] - a[1]) / (b[1] - a[1] || 1);
            addUnique(points, [
              first.points[firstEdge][0] +
                (first.points[firstNext][0] - first.points[firstEdge][0]) * t,
              first.points[firstEdge][1] +
                (first.points[firstNext][1] - first.points[firstEdge][1]) * t,
              first.points[firstEdge][2] +
                (first.points[firstNext][2] - first.points[firstEdge][2]) * t,
            ]);
          }
        }
      }
    }
  }
  first.points.forEach((point, index) => {
    if (pointInTriangle2(first2[index], second2)) addUnique(points, point);
  });
  second.points.forEach((point, index) => {
    if (pointInTriangle2(second2[index], first2)) addUnique(points, point);
  });
  return points;
}

function addPlaneIntersections(
  source: TriangleGeometry,
  target: TriangleGeometry,
  points: Vec3[],
): void {
  const [targetA] = target.points;
  const targetNormal = cross3(
    subtract(target.points[1], targetA),
    subtract(target.points[2], targetA),
  );
  const normalLength = Math.sqrt(lengthSquared(targetNormal));
  const distances = source.points.map(
    (point) => dot(targetNormal, subtract(point, targetA)) / normalLength,
  );
  for (let edge = 0; edge < 3; edge += 1) {
    const next = (edge + 1) % 3;
    const firstDistance = distances[edge];
    const secondDistance = distances[next];
    if (Math.abs(firstDistance) <= BROWSER_MESH_EPSILON)
      if (pointInTriangle(source.points[edge], target))
        addUnique(points, source.points[edge]);
    if (
      Math.abs(firstDistance) <= BROWSER_MESH_EPSILON &&
      Math.abs(secondDistance) <= BROWSER_MESH_EPSILON
    ) {
      if (pointInTriangle(source.points[next], target))
        addUnique(points, source.points[next]);
      continue;
    }
    if (
      (firstDistance < -BROWSER_MESH_EPSILON &&
        secondDistance > BROWSER_MESH_EPSILON) ||
      (firstDistance > BROWSER_MESH_EPSILON &&
        secondDistance < -BROWSER_MESH_EPSILON)
    ) {
      const t = firstDistance / (firstDistance - secondDistance);
      const point: Vec3 = [
        source.points[edge][0] +
          (source.points[next][0] - source.points[edge][0]) * t,
        source.points[edge][1] +
          (source.points[next][1] - source.points[edge][1]) * t,
        source.points[edge][2] +
          (source.points[next][2] - source.points[edge][2]) * t,
      ];
      if (pointInTriangle(point, target)) addUnique(points, point);
    }
  }
}

function allowedIntersection(
  point: Vec3,
  first: TriangleGeometry,
  second: TriangleGeometry,
): boolean {
  const shared = first.indices.filter((index) =>
    second.indices.includes(index),
  );
  if (shared.length === 1)
    return (
      distanceSquared(point, first.points[first.indices.indexOf(shared[0])]) <=
      BROWSER_MESH_EPSILON ** 2
    );
  if (shared.length === 2) {
    const firstA = first.points[first.indices.indexOf(shared[0])];
    const firstB = first.points[first.indices.indexOf(shared[1])];
    return pointOnSegment(point, firstA, firstB);
  }
  return false;
}

function trianglesIntersectBeyondSharedFeature(
  first: TriangleGeometry,
  second: TriangleGeometry,
): boolean {
  const firstNormal = cross3(
    subtract(first.points[1], first.points[0]),
    subtract(first.points[2], first.points[0]),
  );
  const secondNormal = cross3(
    subtract(second.points[1], second.points[0]),
    subtract(second.points[2], second.points[0]),
  );
  const firstNormalLength = Math.sqrt(lengthSquared(firstNormal));
  const secondNormalLength = Math.sqrt(lengthSquared(secondNormal));
  const firstDistances = second.points.map(
    (point) =>
      dot(firstNormal, subtract(point, first.points[0])) / firstNormalLength,
  );
  const secondDistances = first.points.map(
    (point) =>
      dot(secondNormal, subtract(point, second.points[0])) / secondNormalLength,
  );
  const coplanar =
    firstDistances.every(
      (distance) => Math.abs(distance) <= BROWSER_MESH_EPSILON,
    ) &&
    secondDistances.every(
      (distance) => Math.abs(distance) <= BROWSER_MESH_EPSILON,
    );
  const points = coplanar
    ? coplanarIntersections(
        first,
        second,
        firstNormal.reduce(
          (axis, value, index) =>
            Math.abs(value) > Math.abs(firstNormal[axis]) ? index : axis,
          0,
        ),
      )
    : (() => {
        const intersections: Vec3[] = [];
        addPlaneIntersections(first, second, intersections);
        addPlaneIntersections(second, first, intersections);
        return intersections;
      })();
  return points.some((point) => !allowedIntersection(point, first, second));
}

function validateIntersections(
  vertices: Float32Array,
  triangles: Uint32Array,
): void {
  const geometries: TriangleGeometry[] = [];
  let min: Vec3 = [Infinity, Infinity, Infinity];
  let max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let triangle = 0; triangle < triangles.length; triangle += 3) {
    const indices: Triangle = [
      triangles[triangle],
      triangles[triangle + 1],
      triangles[triangle + 2],
    ];
    const points = indices.map(
      (index) =>
        [
          vertices[index * 3],
          vertices[index * 3 + 1],
          vertices[index * 3 + 2],
        ] as Vec3,
    ) as [Vec3, Vec3, Vec3];
    const localMin: Vec3 = [
      Math.min(...points.map((point) => point[0])),
      Math.min(...points.map((point) => point[1])),
      Math.min(...points.map((point) => point[2])),
    ];
    const localMax: Vec3 = [
      Math.max(...points.map((point) => point[0])),
      Math.max(...points.map((point) => point[1])),
      Math.max(...points.map((point) => point[2])),
    ];
    min = [
      Math.min(min[0], localMin[0]),
      Math.min(min[1], localMin[1]),
      Math.min(min[2], localMin[2]),
    ];
    max = [
      Math.max(max[0], localMax[0]),
      Math.max(max[1], localMax[1]),
      Math.max(max[2], localMax[2]),
    ];
    geometries.push({ indices, points, min: localMin, max: localMax });
  }
  const extent = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  if (!Number.isFinite(extent) || extent <= BROWSER_MESH_EPSILON) invalid();
  const cellSize = extent / GRID_AXIS;
  const cells = new Map<string, number[]>();
  let assignments = 0;
  const cellIndex = (value: number, axisMin: number) =>
    Math.max(
      0,
      Math.min(GRID_AXIS - 1, Math.floor((value - axisMin) / cellSize)),
    );
  for (let index = 0; index < geometries.length; index += 1) {
    const geometry = geometries[index];
    const x0 = cellIndex(geometry.min[0] - BROWSER_MESH_EPSILON, min[0]);
    const x1 = cellIndex(geometry.max[0] + BROWSER_MESH_EPSILON, min[0]);
    const y0 = cellIndex(geometry.min[1] - BROWSER_MESH_EPSILON, min[1]);
    const y1 = cellIndex(geometry.max[1] + BROWSER_MESH_EPSILON, min[1]);
    const z0 = cellIndex(geometry.min[2] - BROWSER_MESH_EPSILON, min[2]);
    const z1 = cellIndex(geometry.max[2] + BROWSER_MESH_EPSILON, min[2]);
    for (let x = x0; x <= x1; x += 1)
      for (let y = y0; y <= y1; y += 1)
        for (let z = z0; z <= z1; z += 1) {
          assignments += 1;
          if (assignments > MAX_GRID_ASSIGNMENTS) failWork();
          const key = `${x},${y},${z}`;
          const bucket = cells.get(key);
          if (bucket) bucket.push(index);
          else cells.set(key, [index]);
        }
  }
  const seenPairs = new Set<string>();
  let candidates = 0;
  let pairVisits = 0;
  for (const bucket of cells.values()) {
    for (let first = 0; first < bucket.length; first += 1)
      for (let second = first + 1; second < bucket.length; second += 1) {
        pairVisits += 1;
        if (pairVisits > MAX_INTERSECTION_PAIR_VISITS) failWork();
        const a = Math.min(bucket[first], bucket[second]);
        const b = Math.max(bucket[first], bucket[second]);
        const pair = `${a}:${b}`;
        if (seenPairs.has(pair)) continue;
        seenPairs.add(pair);
        candidates += 1;
        if (candidates > MAX_INTERSECTION_CANDIDATES) failWork();
        const firstGeometry = geometries[a];
        const secondGeometry = geometries[b];
        if (
          firstGeometry.max[0] < secondGeometry.min[0] - BROWSER_MESH_EPSILON ||
          secondGeometry.max[0] < firstGeometry.min[0] - BROWSER_MESH_EPSILON ||
          firstGeometry.max[1] < secondGeometry.min[1] - BROWSER_MESH_EPSILON ||
          secondGeometry.max[1] < firstGeometry.min[1] - BROWSER_MESH_EPSILON ||
          firstGeometry.max[2] < secondGeometry.min[2] - BROWSER_MESH_EPSILON ||
          secondGeometry.max[2] < firstGeometry.min[2] - BROWSER_MESH_EPSILON
        )
          continue;
        if (
          trianglesIntersectBeyondSharedFeature(firstGeometry, secondGeometry)
        )
          invalid();
      }
  }
}

export function validateBrowserMesh(
  verticesInput: readonly (readonly [number, number, number])[],
  trianglesInput: readonly (readonly [number, number, number])[],
): ValidatedBrowserMesh {
  if (
    verticesInput.length < 4 ||
    verticesInput.length > MAX_BROWSER_MESH_VERTICES
  )
    invalid();
  if (
    trianglesInput.length < 4 ||
    trianglesInput.length > MAX_BROWSER_MESH_TRIANGLES
  )
    invalid();
  const vertices = new Float32Array(verticesInput.length * 3);
  const used = new Uint32Array(verticesInput.length);
  const vertexKeys = new Set<string>();
  for (let index = 0; index < verticesInput.length; index += 1) {
    const source = verticesInput[index];
    if (!Array.isArray(source) || source.length !== 3) invalid();
    for (let axis = 0; axis < 3; axis += 1) {
      const value = source[axis];
      if (!Number.isFinite(value) || Math.abs(value) > 100) invalid();
      vertices[index * 3 + axis] = Math.fround(value);
    }
    const key = `${vertices[index * 3]},${vertices[index * 3 + 1]},${vertices[index * 3 + 2]}`;
    if (vertexKeys.has(key)) invalid();
    vertexKeys.add(key);
  }
  const triangles = new Uint32Array(trianglesInput.length * 3);
  const triangleKeys = new Set<string>();
  const edges = new Map<string, EdgeUse>();
  const edgeCounts = new Map<string, number>();
  const adjacent: number[][] = Array.from(
    { length: trianglesInput.length },
    () => [],
  );
  let signedVolume = 0;
  for (let triangle = 0; triangle < trianglesInput.length; triangle += 1) {
    const source = trianglesInput[triangle];
    if (!Array.isArray(source) || source.length !== 3) invalid();
    const [a, b, c] = source;
    if (
      ![a, b, c].every(
        (index) =>
          Number.isSafeInteger(index) &&
          index >= 0 &&
          index < verticesInput.length,
      )
    )
      invalid();
    if (a === b || b === c || c === a) invalid();
    const sorted = [a, b, c].sort((left, right) => left - right).join(",");
    if (triangleKeys.has(sorted)) invalid();
    triangleKeys.add(sorted);
    triangles.set([a, b, c], triangle * 3);
    used[a] += 1;
    used[b] += 1;
    used[c] += 1;
    const pointA: Vec3 = [
      vertices[a * 3],
      vertices[a * 3 + 1],
      vertices[a * 3 + 2],
    ];
    const pointB: Vec3 = [
      vertices[b * 3],
      vertices[b * 3 + 1],
      vertices[b * 3 + 2],
    ];
    const pointC: Vec3 = [
      vertices[c * 3],
      vertices[c * 3 + 1],
      vertices[c * 3 + 2],
    ];
    const normal = cross3(subtract(pointB, pointA), subtract(pointC, pointA));
    const longestEdge = Math.max(
      Math.sqrt(lengthSquared(subtract(pointB, pointA))),
      Math.sqrt(lengthSquared(subtract(pointC, pointB))),
      Math.sqrt(lengthSquared(subtract(pointA, pointC))),
    );
    if (Math.sqrt(lengthSquared(normal)) <= BROWSER_MESH_EPSILON * longestEdge)
      invalid();
    signedVolume += dot(pointA, normal) / 6;
    for (const [from, to] of [
      [a, b],
      [b, c],
      [c, a],
    ] as [number, number][]) {
      const key = `${Math.min(from, to)}:${Math.max(from, to)}`;
      const count = edgeCounts.get(key) ?? 0;
      if (count >= 2) invalid();
      edgeCounts.set(key, count + 1);
      const existing = edges.get(key);
      if (existing) {
        if (existing.from === from && existing.to === to) invalid();
        adjacent[triangle].push(existing.triangle);
        adjacent[existing.triangle].push(triangle);
      } else edges.set(key, { from, to, triangle });
    }
  }
  if (Array.from(used).some((count) => count === 0)) invalid();
  if (Array.from(edgeCounts.values()).some((count) => count !== 2)) invalid();
  const visited = new Set<number>([0]);
  const queue = [0];
  while (queue.length) {
    const current = queue.shift()!;
    for (const neighbor of adjacent[current])
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push(neighbor);
      }
  }
  if (
    visited.size !== trianglesInput.length ||
    signedVolume <= MIN_SIGNED_VOLUME
  )
    invalid();
  validateIntersections(vertices, triangles);
  return { vertices, triangles };
}
