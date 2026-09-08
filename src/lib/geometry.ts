import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { Entity } from "./protocol";
export function entityGeometry(entity: Entity): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const tint =
    entity.geometry?.kind !== "asset" && entity.geometry?.kind !== "generated"
      ? entity.geometry?.tint
      : undefined;
  const coarse = entity.geometry?.detail === "coarse";
  const segments = coarse ? 6 : 14;
  const add = (
    g: THREE.BufferGeometry,
    p = [0, 0, 0],
    s = [1, 1, 1],
    color = entity.color,
    r = [0, 0, 0],
  ) => {
    let geometry = g.index ? g.toNonIndexed() : g;
    if (geometry !== g) g.dispose();
    geometry.deleteAttribute("uv");
    geometry.applyMatrix4(
      new THREE.Matrix4().compose(
        new THREE.Vector3(...p),
        new THREE.Quaternion().setFromEuler(
          new THREE.Euler(...(r as [number, number, number])),
        ),
        new THREE.Vector3(...s),
      ),
    );
    const c = new THREE.Color(tint ?? color);
    const colors = new Float32Array(geometry.attributes.position.count * 3);
    for (let i = 0; i < colors.length; i += 3) {
      colors[i] = c.r;
      colors[i + 1] = c.g;
      colors[i + 2] = c.b;
    }
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    parts.push(geometry);
  };
  const sphere = (p: number[], s: number[], c = entity.color) =>
    add(new THREE.SphereGeometry(1, segments, segments), p, s, c);
  const cylinder = (p: number[], s: number[], c = entity.color) =>
    add(new THREE.CylinderGeometry(0.65, 1, 1, segments), p, s, c);
  switch (entity.geometry?.kind) {
    case "tree":
      cylinder([0, 0.8, 0], [0.2, 1.6, 0.2], "#98775a");
      sphere([0, 2, 0], [0.95, 1.05, 0.9]);
      if (!coarse) {
        sphere([-0.55, 1.65, 0.15], [0.6, 0.75, 0.6]);
        sphere([0.55, 1.9, 0.15], [0.55, 0.7, 0.55]);
      }
      break;
    case "mushroom":
      cylinder([0, 0.7, 0], [0.25, 1.4, 0.25], "#f6ebd3");
      sphere([0, 1.5, 0], [1.15, 0.65, 1.15]);
      if (!coarse)
        for (let i = 0; i < 7; i++)
          sphere(
            [
              Math.cos(i * 2.4) * 0.7,
              1.94 + Math.sin(i) * 0.05,
              Math.sin(i * 2.4) * 0.7,
            ],
            [0.13, 0.045, 0.13],
            "#fff1de",
          );
      break;
    case "platform":
      add(new THREE.BoxGeometry(1, 0.45, 1, 2, 2, 2), [0, 0.2, 0]);
      add(
        new THREE.BoxGeometry(0.9, 0.1, 0.9),
        [0, 0.47, 0],
        [1, 1, 1],
        "#fff2cf",
      );
      break;
    case "arch":
      for (const x of [-0.8, 0.8]) {
        cylinder([x, 1, 0], [0.24, 2, 0.25]);
        add(new THREE.BoxGeometry(0.65, 0.2, 0.65), [x, 0.1, 0]);
      }
      add(new THREE.TorusGeometry(0.8, 0.23, 8, 24, Math.PI), [0, 1.85, 0]);
      if (!coarse) sphere([0, 2.75, 0], [0.16, 0.16, 0.16], "#f8d88d");
      break;
    case "crystal":
      add(
        new THREE.OctahedronGeometry(0.65, 0),
        [0, 0.5, 0],
        [0.65, 1.25, 0.65],
      );
      break;
    case "pond":
      cylinder([0, 0.02, 0], [1.3, 0.055, 1], "#d3d7a8");
      cylinder([0, 0.06, 0], [1.2, 0.065, 0.9], entity.color);
      break;
    case "flower":
      cylinder([0, 0.5, 0], [0.055, 1, 0.055], "#779963");
      for (let i = 0; i < (coarse ? 4 : 7); i++) {
        const a = (i * Math.PI * 2) / (coarse ? 4 : 7);
        sphere(
          [Math.cos(a) * 0.3, 1.04, Math.sin(a) * 0.3],
          [0.26, 0.15, 0.26],
        );
      }
      sphere([0, 1.12, 0], [0.19, 0.13, 0.19], "#ffdf92");
      sphere([0.19, 0.4, 0], [0.3, 0.08, 0.12], "#91b878");
      break;
    case "rock":
      sphere([0, 0.35, 0], [0.7, 0.55, 0.6]);
      sphere([0.55, 0.18, 0.15], [0.35, 0.3, 0.4]);
      break;
    case "custom":
      for (const part of entity.geometry.parts ?? []) {
        const g =
          part.shape === "box"
            ? new THREE.BoxGeometry(1, 1, 1, 2, 2, 2)
            : part.shape === "cone"
              ? new THREE.ConeGeometry(1, 1, segments)
              : part.shape === "cylinder"
                ? new THREE.CylinderGeometry(1, 1, 1, segments)
                : part.shape === "torus"
                  ? new THREE.TorusGeometry(0.7, 0.25, 8, segments)
                  : new THREE.SphereGeometry(1, segments, segments);
        add(g, part.position, part.scale, part.color, part.rotation);
      }
      break;
    default:
      sphere([0, 0.65, 0], [0.5, 0.5, 0.5], "#bceee0");
  }
  if (!parts.length) sphere([0, 0.5, 0], [0.5, 0.5, 0.5]);
  const merged = mergeGeometries(parts);
  parts.forEach((g) => g.dispose());
  merged.computeBoundingSphere();
  return merged;
}
export interface FormationSnapshot {
  positions: Float32Array;
  colors: Float32Array;
}

function validTriplets(values: unknown): values is Float32Array {
  return (
    values instanceof Float32Array &&
    values.length > 0 &&
    values.length % 3 === 0 &&
    values.every((value) => Number.isFinite(value))
  );
}

type FormationAttribute =
  THREE.BufferAttribute | THREE.InterleavedBufferAttribute;

function finiteAttribute(
  attribute: FormationAttribute | undefined,
  count: number,
  fallback: number,
) {
  const values = new Float32Array(count * 3);
  if (!attribute || attribute.count !== count || attribute.itemSize < 3) {
    values.fill(fallback);
    return values;
  }
  for (let index = 0; index < count; index++) {
    const targetIndex = index * 3;
    const x = attribute.getX(index);
    const y = attribute.getY(index);
    const z = attribute.getZ(index);
    values[targetIndex] = Number.isFinite(x) ? x : fallback;
    values[targetIndex + 1] = Number.isFinite(y) ? y : fallback;
    values[targetIndex + 2] = Number.isFinite(z) ? z : fallback;
  }
  return values;
}

function validFormationAttribute(
  attribute: FormationAttribute | undefined,
  count: number,
) {
  if (!attribute || attribute.count !== count || attribute.itemSize < 3)
    return false;
  for (let index = 0; index < count; index++) {
    if (
      !Number.isFinite(attribute.getX(index)) ||
      !Number.isFinite(attribute.getY(index)) ||
      !Number.isFinite(attribute.getZ(index))
    )
      return false;
  }
  return true;
}

function formationEase(progress: number) {
  if (!Number.isFinite(progress)) return 1;
  const clamped = Math.min(1, Math.max(0, progress));
  return clamped * clamped * (3 - 2 * clamped);
}

export function captureFormationSnapshot(
  geometry: THREE.BufferGeometry,
  progress: number,
): FormationSnapshot {
  const positionAttribute = geometry.getAttribute("position");
  const count = positionAttribute?.count ?? 0;
  const positions = finiteAttribute(positionAttribute, count, 0);
  const colors = finiteAttribute(geometry.getAttribute("color"), count, 1);
  const fromPositions = finiteAttribute(
    geometry.getAttribute("aFrom"),
    count,
    0,
  );
  const fromColors = finiteAttribute(
    geometry.getAttribute("aFromColor"),
    count,
    1,
  );
  const fromPositionAttribute = geometry.getAttribute("aFrom");
  const fromColorAttribute = geometry.getAttribute("aFromColor");
  const positionSource = validFormationAttribute(fromPositionAttribute, count)
    ? fromPositions
    : positions;
  const colorSource = validFormationAttribute(fromColorAttribute, count)
    ? fromColors
    : colors;
  const ease = formationEase(progress);
  if (ease === 0)
    return {
      positions: positionSource.slice(),
      colors: colorSource.slice(),
    };
  if (ease === 1)
    return { positions: positions.slice(), colors: colors.slice() };
  const visiblePositions = new Float32Array(positions.length);
  const visibleColors = new Float32Array(colors.length);
  for (let index = 0; index < positions.length; index++)
    visiblePositions[index] =
      positionSource[index] + (positions[index] - positionSource[index]) * ease;
  for (let index = 0; index < colors.length; index++)
    visibleColors[index] =
      colorSource[index] + (colors[index] - colorSource[index]) * ease;
  return { positions: visiblePositions, colors: visibleColors };
}

export function addFormationSource(
  geometry: THREE.BufferGeometry,
  previous?: Float32Array | FormationSnapshot,
) {
  const position = geometry.getAttribute("position");
  const count = position?.count ?? 0;
  const targetPositions = finiteAttribute(position, count, 0);
  const targetColors = finiteAttribute(
    geometry.getAttribute("color"),
    count,
    1,
  );
  const snapshot =
    previous && !(previous instanceof Float32Array) ? previous : undefined;
  const previousPositions = snapshot?.positions ?? previous;
  const previousColors = snapshot?.colors;
  const hasPreviousPositions = validTriplets(previousPositions);
  const hasPreviousColors = validTriplets(previousColors);
  const previousPositionCount = hasPreviousPositions
    ? previousPositions.length / 3
    : 0;
  const previousColorCount = hasPreviousColors ? previousColors.length / 3 : 0;
  const matchingPreviousColors =
    snapshot &&
    hasPreviousPositions &&
    hasPreviousColors &&
    previousColorCount === previousPositionCount;
  const source = new Float32Array(targetPositions.length);
  const sourceColors = new Float32Array(targetColors.length);
  sourceColors.set(targetColors);
  for (let index = 0; index < count; index++) {
    const targetIndex = index * 3;
    if (hasPreviousPositions) {
      const sourceCount = previousPositionCount;
      const sourceIndex = (index % Math.max(1, sourceCount)) * 3;
      source[targetIndex] = previousPositions[sourceIndex];
      source[targetIndex + 1] = previousPositions[sourceIndex + 1];
      source[targetIndex + 2] = previousPositions[sourceIndex + 2];
    } else if (!previous) {
      const y = count ? 1 - (2 * (index + 0.5)) / count : 0;
      const a = index * 2.399963;
      const r = Math.sqrt(Math.max(0, 1 - y * y)) * 0.58;
      source[targetIndex] = Math.cos(a) * r;
      source[targetIndex + 1] = y * 0.58 + 0.7;
      source[targetIndex + 2] = Math.sin(a) * r;
    } else {
      source[targetIndex] = targetPositions[targetIndex];
      source[targetIndex + 1] = targetPositions[targetIndex + 1];
      source[targetIndex + 2] = targetPositions[targetIndex + 2];
    }
    if (matchingPreviousColors && previousColors) {
      const sourceIndex = (index % previousColorCount) * 3;
      sourceColors[targetIndex] = previousColors[sourceIndex];
      sourceColors[targetIndex + 1] = previousColors[sourceIndex + 1];
      sourceColors[targetIndex + 2] = previousColors[sourceIndex + 2];
    }
  }
  geometry.setAttribute("aFrom", new THREE.BufferAttribute(source, 3));
  geometry.setAttribute(
    "aFromColor",
    new THREE.BufferAttribute(sourceColors, 3),
  );
  return geometry;
}
export function terrainValue(x: number, y: number, z: number) {
  return (
    Math.sin(x * 2.3 + Math.cos(z * 3.1)) * Math.cos(y * 2.8 - z) +
    Math.sin(z * 4 + x * 1.3) * 0.32 +
    Math.sin(y * 7 - z * 4) * 0.15
  );
}
