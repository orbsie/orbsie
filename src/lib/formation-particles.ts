import * as THREE from "three";

const DEFAULT_MAX_POINTS = 2048;
const HARD_MAX_POINTS = 4096;
const GOLDEN_RATIO = 0.6180339887498949;
const TRIANGLE_PROBE_RATIO = 0.7548776662466927;

type FormationAttribute =
  THREE.BufferAttribute | THREE.InterleavedBufferAttribute;
type Vec3 = readonly [number, number, number];
export type FormationTextureUv = readonly [number, number];

export interface FormationTextureSample {
  readonly pixels: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly colorSpace: "srgb" | "srgb-linear" | "";
  readonly wrapS: THREE.Wrapping;
  readonly wrapT: THREE.Wrapping;
  readonly magFilter: THREE.MagnificationTextureFilter;
  readonly minFilter: THREE.MinificationTextureFilter;
}

interface SurfaceTriangle {
  readonly position: readonly [Vec3, Vec3, Vec3];
  readonly color: readonly [Vec3, Vec3, Vec3];
  readonly uv:
    | readonly [FormationTextureUv, FormationTextureUv, FormationTextureUv]
    | undefined;
  readonly from: readonly [Vec3, Vec3, Vec3];
  readonly fromColor: readonly [Vec3, Vec3, Vec3];
  readonly area: number;
}

function emptyFormationParticles(): THREE.BufferGeometry {
  const output = new THREE.BufferGeometry();
  for (const name of ["position", "color", "aFrom", "aFromColor"])
    output.setAttribute(name, new THREE.Float32BufferAttribute([], 3));
  output.computeBoundingBox();
  output.computeBoundingSphere();
  return output;
}

function boundedPointCount(maxPoints: number): number {
  if (maxPoints === Number.POSITIVE_INFINITY) return HARD_MAX_POINTS;
  if (maxPoints === Number.NEGATIVE_INFINITY) return 0;
  if (Number.isNaN(maxPoints)) return DEFAULT_MAX_POINTS;
  if (!Number.isFinite(maxPoints)) return DEFAULT_MAX_POINTS;
  return Math.max(0, Math.min(HARD_MAX_POINTS, Math.floor(maxPoints)));
}

function readTriple(
  attribute: FormationAttribute | undefined,
  index: number,
): Vec3 | undefined {
  if (
    !attribute ||
    attribute.itemSize < 3 ||
    index < 0 ||
    index >= attribute.count
  )
    return undefined;
  const value: Vec3 = [
    attribute.getX(index),
    attribute.getY(index),
    attribute.getZ(index),
  ];
  return value.every(Number.isFinite) ? value : undefined;
}

function indexAt(
  index: THREE.BufferAttribute,
  offset: number,
): number | undefined {
  const value = index.getX(offset);
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function fractional(value: number): number {
  return value - Math.floor(value);
}

/** Stable [0, 1) sequences with no dependency on Math.random(). */
function sampleCoordinate(index: number): [number, number, number] {
  const triangleProbe = fractional((index + 1.5) * GOLDEN_RATIO);
  const barycentricRoot = fractional((index + 0.5) * TRIANGLE_PROBE_RATIO);
  const barycentricSplit = fractional((index + 0.25) * 0.5698402909980532);
  return [triangleProbe, barycentricRoot, barycentricSplit];
}

function writeInterpolation(
  target: Float32Array,
  offset: number,
  values: readonly [Vec3, Vec3, Vec3],
  weights: readonly [number, number, number],
): void {
  const [a, b, c] = values;
  const [wa, wb, wc] = weights;
  target[offset] = a[0] * wa + b[0] * wb + c[0] * wc;
  target[offset + 1] = a[1] * wa + b[1] * wb + c[1] * wc;
  target[offset + 2] = a[2] * wa + b[2] * wb + c[2] * wc;
}

function readPair(
  attribute: FormationAttribute | undefined,
  index: number,
): FormationTextureUv | undefined {
  if (
    !attribute ||
    attribute.itemSize < 2 ||
    index < 0 ||
    index >= attribute.count
  )
    return undefined;
  const value: FormationTextureUv = [
    attribute.getX(index),
    attribute.getY(index),
  ];
  return value.every(Number.isFinite) ? value : undefined;
}

function wrapCoordinate(value: number, wrapping: THREE.Wrapping): number {
  if (wrapping === THREE.ClampToEdgeWrapping)
    return Math.max(0, Math.min(1, value));
  if (wrapping === THREE.MirroredRepeatWrapping) {
    const period = Math.floor(value);
    const remainder = value - period;
    return period % 2 === 0 ? remainder : 1 - remainder;
  }
  return fractional(value);
}

function wrapIndex(
  value: number,
  size: number,
  wrapping: THREE.Wrapping,
): number {
  if (wrapping === THREE.ClampToEdgeWrapping)
    return Math.max(0, Math.min(size - 1, value));
  const period = wrapping === THREE.MirroredRepeatWrapping ? size * 2 : size;
  let result = value % period;
  if (result < 0) result += period;
  if (wrapping === THREE.MirroredRepeatWrapping)
    result = result >= size ? period - 1 - result : result;
  return result;
}

function srgbToLinear(value: number): number {
  return value <= 0.04045
    ? value / 12.92
    : Math.pow((value + 0.055) / 1.055, 2.4);
}

function textureLinearFilter(texture: FormationTextureSample): boolean {
  // Formation samples have no screen-space derivatives or mip level. Use the
  // declared base-level magnification policy so the worker and renderer stay
  // deterministic for every valid sampler combination.
  return texture.magFilter === THREE.LinearFilter;
}

function texel(texture: FormationTextureSample, x: number, y: number): Vec3 {
  const offset =
    (wrapIndex(x, texture.width, texture.wrapS) +
      wrapIndex(y, texture.height, texture.wrapT) * texture.width) *
    4;
  const pixels = texture.pixels;
  const channels: Vec3 = [
    (pixels[offset] ?? 0) / 255,
    (pixels[offset + 1] ?? 0) / 255,
    (pixels[offset + 2] ?? 0) / 255,
  ];
  return texture.colorSpace === "srgb"
    ? [
        srgbToLinear(channels[0]),
        srgbToLinear(channels[1]),
        srgbToLinear(channels[2]),
      ]
    : channels;
}

/** Sample one atlas UV in the same bounded, linear-space way as formation particles. */
export function sampleTexture(
  texture: FormationTextureSample,
  uv: FormationTextureUv,
): Vec3 {
  const u = wrapCoordinate(uv[0], texture.wrapS);
  const v = wrapCoordinate(uv[1], texture.wrapT);
  const x = u * texture.width - 0.5;
  const y = v * texture.height - 0.5;
  if (!textureLinearFilter(texture))
    return texel(texture, Math.floor(x + 0.5), Math.floor(y + 0.5));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const fx = x - x0;
  const fy = y - y0;
  const c00 = texel(texture, x0, y0);
  const c10 = texel(texture, x1, y0);
  const c01 = texel(texture, x0, y1);
  const c11 = texel(texture, x1, y1);
  return [
    (c00[0] * (1 - fx) + c10[0] * fx) * (1 - fy) +
      (c01[0] * (1 - fx) + c11[0] * fx) * fy,
    (c00[1] * (1 - fx) + c10[1] * fx) * (1 - fy) +
      (c01[1] * (1 - fx) + c11[1] * fx) * fy,
    (c00[2] * (1 - fx) + c10[2] * fx) * (1 - fy) +
      (c01[2] * (1 - fx) + c11[2] * fx) * fy,
  ];
}

function makeTriangle(
  position: FormationAttribute,
  color: FormationAttribute | undefined,
  uv: FormationAttribute | undefined,
  from: FormationAttribute | undefined,
  fromColor: FormationAttribute | undefined,
  indices: readonly [number, number, number],
): SurfaceTriangle | undefined {
  const [ia, ib, ic] = indices;
  const a = readTriple(position, ia);
  const b = readTriple(position, ib);
  const c = readTriple(position, ic);
  if (!a || !b || !c) return undefined;

  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const abz = b[2] - a[2];
  const acx = c[0] - a[0];
  const acy = c[1] - a[1];
  const acz = c[2] - a[2];
  const crossX = aby * acz - abz * acy;
  const crossY = abz * acx - abx * acz;
  const crossZ = abx * acy - aby * acx;
  const area = 0.5 * Math.hypot(crossX, crossY, crossZ);
  if (!Number.isFinite(area) || area <= 0) return undefined;

  const targetColor = color
    ? [readTriple(color, ia), readTriple(color, ib), readTriple(color, ic)]
    : undefined;
  if (targetColor && targetColor.some((value) => !value)) return undefined;
  const resolvedColor = targetColor as [Vec3, Vec3, Vec3] | undefined;
  const textureUv = uv
    ? [readPair(uv, ia), readPair(uv, ib), readPair(uv, ic)]
    : undefined;
  if (textureUv && textureUv.some((value) => !value)) return undefined;
  const source = from
    ? [readTriple(from, ia), readTriple(from, ib), readTriple(from, ic)]
    : undefined;
  if (source && source.some((value) => !value)) return undefined;
  const resolvedSource = (source as [Vec3, Vec3, Vec3] | undefined) ?? [
    a,
    b,
    c,
  ];
  const sourceColor = fromColor
    ? [
        readTriple(fromColor, ia),
        readTriple(fromColor, ib),
        readTriple(fromColor, ic),
      ]
    : undefined;
  if (sourceColor && sourceColor.some((value) => !value)) return undefined;
  const resolvedSourceColor = (sourceColor as [Vec3, Vec3, Vec3] | undefined) ??
    resolvedColor ?? [
      [1, 1, 1],
      [1, 1, 1],
      [1, 1, 1],
    ];

  return {
    position: [a, b, c],
    color: resolvedColor ?? [
      [1, 1, 1],
      [1, 1, 1],
      [1, 1, 1],
    ],
    uv: textureUv as
      [FormationTextureUv, FormationTextureUv, FormationTextureUv] | undefined,
    from: resolvedSource,
    fromColor: resolvedSourceColor,
    area,
  };
}

function collectTriangles(geometry: THREE.BufferGeometry): SurfaceTriangle[] {
  const position = geometry.getAttribute("position") as
    FormationAttribute | undefined;
  if (!position || position.itemSize < 3 || position.count < 3) return [];

  const color = geometry.getAttribute("color") as
    FormationAttribute | undefined;
  const uv = geometry.getAttribute("uv") as FormationAttribute | undefined;
  const from = geometry.getAttribute("aFrom") as FormationAttribute | undefined;
  const fromColor = geometry.getAttribute("aFromColor") as
    FormationAttribute | undefined;
  const triangles: SurfaceTriangle[] = [];
  const index = geometry.index;
  const triangleCount = Math.floor((index?.count ?? position.count) / 3);
  for (let triangle = 0; triangle < triangleCount; triangle++) {
    const offset = triangle * 3;
    const indices: [number, number, number] = index
      ? [
          indexAt(index, offset) ?? -1,
          indexAt(index, offset + 1) ?? -1,
          indexAt(index, offset + 2) ?? -1,
        ]
      : [offset, offset + 1, offset + 2];
    if (indices.some((value) => value >= position.count)) continue;
    const sampled = makeTriangle(position, color, uv, from, fromColor, indices);
    if (sampled) triangles.push(sampled);
  }
  return triangles;
}

export function formationParticles(
  geometry: THREE.BufferGeometry,
  maxPoints = DEFAULT_MAX_POINTS,
  texture?: FormationTextureSample,
): THREE.BufferGeometry {
  const pointCount = boundedPointCount(maxPoints);
  if (pointCount === 0) return emptyFormationParticles();
  const preparedPosition = geometry.getAttribute("formationPosition");
  const preparedColor = geometry.getAttribute("formationColor");
  if (
    preparedPosition?.itemSize === 3 &&
    preparedColor?.itemSize === 3 &&
    preparedPosition.count > 0 &&
    preparedPosition.count <= HARD_MAX_POINTS &&
    preparedColor.count === preparedPosition.count &&
    preparedPosition.array instanceof Float32Array &&
    preparedColor.array instanceof Float32Array &&
    preparedPosition.array.every(Number.isFinite) &&
    preparedColor.array.every(Number.isFinite)
  ) {
    const count = Math.min(pointCount, preparedPosition.count);
    const output = new THREE.BufferGeometry();
    for (const [name, attribute] of [
      ["position", preparedPosition],
      ["color", preparedColor],
      ["aFrom", preparedPosition],
      ["aFromColor", preparedColor],
    ] as const)
      output.setAttribute(
        name,
        new THREE.Float32BufferAttribute(
          attribute.array.slice(0, count * 3),
          3,
        ),
      );
    output.computeBoundingBox();
    output.computeBoundingSphere();
    return output;
  }
  const triangles = collectTriangles(geometry);
  if (!triangles.length) return emptyFormationParticles();

  let largestArea = 0;
  for (const triangle of triangles)
    largestArea = Math.max(largestArea, triangle.area);
  const cumulative = new Float64Array(triangles.length);
  let totalWeight = 0;
  for (let index = 0; index < triangles.length; index++) {
    totalWeight += triangles[index].area / largestArea;
    cumulative[index] = totalWeight;
  }

  const positions = new Float32Array(pointCount * 3);
  const colors = new Float32Array(pointCount * 3);
  const fromPositions = new Float32Array(pointCount * 3);
  const fromColors = new Float32Array(pointCount * 3);
  for (let sample = 0; sample < pointCount; sample++) {
    const [triangleProbe, barycentricRootProbe, barycentricSplitProbe] =
      sampleCoordinate(sample);
    const targetWeight = triangleProbe * totalWeight;
    let low = 0;
    let high = cumulative.length - 1;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (targetWeight < cumulative[middle]) high = middle;
      else low = middle + 1;
    }
    const triangle = triangles[low];
    const root = Math.sqrt(barycentricRootProbe);
    const weights: [number, number, number] = [
      1 - root,
      root * (1 - barycentricSplitProbe),
      root * barycentricSplitProbe,
    ];
    const offset = sample * 3;
    writeInterpolation(positions, offset, triangle.position, weights);
    writeInterpolation(colors, offset, triangle.color, weights);
    if (texture && triangle.uv) {
      const uv: FormationTextureUv = [
        triangle.uv[0][0] * weights[0] +
          triangle.uv[1][0] * weights[1] +
          triangle.uv[2][0] * weights[2],
        triangle.uv[0][1] * weights[0] +
          triangle.uv[1][1] * weights[1] +
          triangle.uv[2][1] * weights[2],
      ];
      const sampled = sampleTexture(texture, uv);
      colors[offset] *= sampled[0];
      colors[offset + 1] *= sampled[1];
      colors[offset + 2] *= sampled[2];
    }
    writeInterpolation(fromPositions, offset, triangle.from, weights);
    writeInterpolation(fromColors, offset, triangle.fromColor, weights);
  }

  const output = new THREE.BufferGeometry();
  output.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  output.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  output.setAttribute(
    "aFrom",
    new THREE.Float32BufferAttribute(fromPositions, 3),
  );
  output.setAttribute(
    "aFromColor",
    new THREE.Float32BufferAttribute(fromColors, 3),
  );
  output.computeBoundingBox();
  output.computeBoundingSphere();
  return output;
}

/** Run in the decode worker before accounting for cache/transfer byte limits. */
export function prepareFormationParticles(
  geometry: THREE.BufferGeometry,
  texture?: FormationTextureSample,
): void {
  const particles = formationParticles(geometry, DEFAULT_MAX_POINTS, texture);
  geometry.setAttribute(
    "formationPosition",
    particles.getAttribute("position").clone(),
  );
  geometry.setAttribute(
    "formationColor",
    particles.getAttribute("color").clone(),
  );
  particles.dispose();
}
