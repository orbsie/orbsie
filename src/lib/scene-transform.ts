import { Euler, Matrix4, Quaternion, Vector3 } from "three";

/** The largest supported scene graph dimensions. */
export const MAX_SCENE_GROUPS = 128;
export const MAX_SCENE_ENTITIES = 160;
/** Depth is counted in groups: a root group has depth 1. */
export const MAX_SCENE_GROUP_DEPTH = 32;

/**
 * The comparison tolerance used when a matrix is converted back to local TRS.
 * It is a relative tolerance with an absolute floor of 1, so a reconstruction
 * must agree to roughly eight decimal places for ordinary scene coordinates.
 */
export const SCENE_TRANSFORM_TOLERANCE = 1e-8;

export type Vec3 = readonly [number, number, number];

/** A structural local transform shared by groups and entities. */
export interface SceneNodeTransform {
  readonly id: string;
  readonly parentId?: string | null;
  readonly position: Vec3;
  readonly rotation?: Vec3;
  readonly scale: Vec3;
}

/** Groups have group-only parents. */
export type SceneGroup = SceneNodeTransform;
/** Entities may be parented to a group, but never directly to an entity. */
export type SceneEntity = SceneNodeTransform;

export interface SceneGraphInput {
  readonly groups?: readonly SceneGroup[];
  readonly entities: readonly SceneEntity[];
}

export interface LocalBounds {
  readonly min: Vec3;
  readonly max: Vec3;
}

export interface WorldBounds {
  readonly min: Vec3;
  readonly max: Vec3;
}

export class SceneTransformValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SceneTransformValidationError";
  }
}

/** Backwards-friendly short name for callers that do not need the long form. */
export interface ResolvedSceneNode {
  readonly id: string;
  readonly kind: "group" | "entity";
  readonly parentId: string | null;
  readonly localMatrix: Matrix4;
  /** The exact composed affine matrix. It is not decomposed or approximated. */
  readonly worldMatrix: Matrix4;
  readonly worldPosition: Vec3;
  /** Alias useful to collision callers that describe the origin explicitly. */
  readonly worldOrigin: Vec3;
}

export interface ResolvedScene {
  readonly groups: ReadonlyMap<string, ResolvedSceneNode>;
  readonly entities: ReadonlyMap<string, ResolvedSceneNode>;
  readonly nodes: ReadonlyMap<string, ResolvedSceneNode>;
  get(id: string): ResolvedSceneNode | undefined;
}

export interface LocalTRS {
  readonly position: Vec3;
  readonly rotation: Vec3;
  readonly scale: Vec3;
}

export interface KeepWorldTransformOptions {
  /** Defaults to SCENE_TRANSFORM_TOLERANCE. */
  readonly tolerance?: number;
}

function fail(message: string): never {
  throw new SceneTransformValidationError(message);
}

function isFiniteVec3(value: unknown): value is Vec3 {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every(
      (component) =>
        typeof component === "number" && Number.isFinite(component),
    )
  );
}

function validateVec3(value: unknown, label: string): asserts value is Vec3 {
  if (!isFiniteVec3(value)) fail(`${label} must contain three finite numbers.`);
}

function validateId(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0)
    fail(`${label} must be a non-empty string.`);
}

function validateParentId(value: unknown, label: string): void {
  if (
    value !== undefined &&
    value !== null &&
    (typeof value !== "string" || value.length === 0)
  )
    fail(`${label} must be a group ID or null.`);
}

function validateNode(
  node: SceneNodeTransform,
  kind: "group" | "entity" | "node",
): void {
  if (!node || typeof node !== "object") fail(`${kind} must be an object.`);
  validateId(node.id, `${kind} ID`);
  validateParentId(node.parentId, `${kind} ${node.id} parentId`);
  validateVec3(node.position, `${kind} ${node.id} position`);
  if (node.rotation !== undefined)
    validateVec3(node.rotation, `${kind} ${node.id} rotation`);
  validateVec3(node.scale, `${kind} ${node.id} scale`);
  if (kind === "group" && node.scale.some((component) => component <= 0))
    fail(`Group ${node.id} scale must be positive and finite.`);
}

function matrixElements(value: unknown, label: string): readonly number[] {
  if (
    !value ||
    typeof value !== "object" ||
    !("elements" in value) ||
    !Array.isArray((value as { elements?: unknown }).elements) ||
    (value as { elements: unknown[] }).elements.length !== 16
  )
    fail(`${label} must be a Three.js Matrix4.`);
  const elements = (value as { elements: number[] }).elements;
  if (!elements.every((component) => Number.isFinite(component)))
    fail(`${label} contains a nonfinite matrix value.`);
  if (
    elements[3] !== 0 ||
    elements[7] !== 0 ||
    elements[11] !== 0 ||
    elements[15] !== 1
  )
    fail(`${label} must have an affine bottom row [0, 0, 0, 1].`);
  return elements;
}

function invertAffineMatrix(matrix: Matrix4, label: string): Matrix4 {
  const inverse = matrix.clone().invert();
  const elements = inverse.elements;
  if (!elements.every((component) => Number.isFinite(component)))
    fail(`${label} contains a nonfinite matrix value.`);
  // Three.js can leave a sub-ulp rounding residue in the inverse's bottom
  // row. The input was already required to be affine, so canonicalize only
  // that generated row before applying the exact affine check.
  if (
    Math.abs(elements[3]) > SCENE_TRANSFORM_TOLERANCE ||
    Math.abs(elements[7]) > SCENE_TRANSFORM_TOLERANCE ||
    Math.abs(elements[11]) > SCENE_TRANSFORM_TOLERANCE ||
    Math.abs(elements[15] - 1) > SCENE_TRANSFORM_TOLERANCE
  )
    fail(`${label} must have an affine bottom row [0, 0, 0, 1].`);
  elements[3] = 0;
  elements[7] = 0;
  elements[11] = 0;
  elements[15] = 1;
  matrixElements(inverse, label);
  return inverse;
}

function composeLocalMatrix(node: SceneNodeTransform): Matrix4 {
  const rotation = node.rotation ?? [0, 0, 0];
  const position = new Vector3(...node.position);
  const scale = new Vector3(...node.scale);
  const quaternion = new Quaternion().setFromEuler(
    new Euler(rotation[0], rotation[1], rotation[2], "XYZ"),
  );
  const matrix = new Matrix4().compose(position, quaternion, scale);
  matrixElements(matrix, `${node.id} local matrix`);
  return matrix;
}

/** Compose one local position/XYZ-radian rotation/scale into a Matrix4. */
export function composeTransformMatrix(node: SceneNodeTransform): Matrix4 {
  validateNode(node, "node");
  return composeLocalMatrix(node);
}

function vec3Tuple(value: Vector3): Vec3 {
  return [value.x, value.y, value.z];
}

function buildResolvedNode(
  node: SceneNodeTransform,
  kind: "group" | "entity",
  localMatrix: Matrix4,
  worldMatrix: Matrix4,
): ResolvedSceneNode {
  matrixElements(worldMatrix, `${kind} ${node.id} world matrix`);
  const origin = new Vector3().setFromMatrixPosition(worldMatrix);
  return {
    id: node.id,
    kind,
    parentId: node.parentId ?? null,
    localMatrix: localMatrix.clone(),
    worldMatrix: worldMatrix.clone(),
    worldPosition: vec3Tuple(origin),
    worldOrigin: vec3Tuple(origin),
  };
}

/**
 * Validate and resolve a bounded group DAG. Group transforms are composed from
 * roots downward; entity parents are looked up only in the group namespace.
 */
export function resolveSceneTransforms(input: SceneGraphInput): ResolvedScene {
  if (!input || typeof input !== "object")
    fail("Scene input must be an object.");
  const groups = input.groups ?? [];
  const entities = input.entities;
  if (!Array.isArray(groups)) fail("Scene groups must be an array.");
  if (!Array.isArray(entities)) fail("Scene entities must be an array.");
  if (groups.length > MAX_SCENE_GROUPS)
    fail(`Scene exceeds the ${MAX_SCENE_GROUPS}-group limit.`);
  if (entities.length > MAX_SCENE_ENTITIES)
    fail(`Scene exceeds the ${MAX_SCENE_ENTITIES}-entity limit.`);

  const groupById = new Map<string, SceneGroup>();
  const allIds = new Set<string>();
  for (const group of groups) {
    validateNode(group, "group");
    if (allIds.has(group.id)) fail(`Duplicate scene ID: ${group.id}.`);
    allIds.add(group.id);
    groupById.set(group.id, group);
  }
  for (const entity of entities) {
    validateNode(entity, "entity");
    if (allIds.has(entity.id)) fail(`Duplicate scene ID: ${entity.id}.`);
    allIds.add(entity.id);
  }

  for (const group of groups) {
    if (group.parentId !== undefined && group.parentId !== null) {
      if (!groupById.has(group.parentId))
        fail(
          `Group ${group.id} references missing group parent ${group.parentId}.`,
        );
      if (group.parentId === group.id)
        fail(`Group ${group.id} cannot parent itself.`);
    }
  }
  for (const entity of entities) {
    if (entity.parentId !== undefined && entity.parentId !== null) {
      if (!groupById.has(entity.parentId))
        fail(
          `Entity ${entity.id} parent ${entity.parentId} must reference a group.`,
        );
    }
  }

  const depthState = new Map<string, "visiting" | "done">();
  const depths = new Map<string, number>();
  const groupDepth = (id: string): number => {
    const state = depthState.get(id);
    if (state === "visiting") fail(`Group parent cycle detected at ${id}.`);
    if (state === "done") return depths.get(id)!;
    depthState.set(id, "visiting");
    const group = groupById.get(id)!;
    const depth =
      group.parentId === undefined || group.parentId === null
        ? 1
        : groupDepth(group.parentId) + 1;
    if (depth > MAX_SCENE_GROUP_DEPTH)
      fail(
        `Group depth exceeds the ${MAX_SCENE_GROUP_DEPTH}-group limit at ${id}.`,
      );
    depthState.set(id, "done");
    depths.set(id, depth);
    return depth;
  };
  for (const group of groups) groupDepth(group.id);

  const resolvedGroups = new Map<string, ResolvedSceneNode>();
  const resolveGroup = (group: SceneGroup): ResolvedSceneNode => {
    const existing = resolvedGroups.get(group.id);
    if (existing) return existing;
    const local = composeLocalMatrix(group);
    const parentWorld =
      group.parentId === undefined || group.parentId === null
        ? new Matrix4()
        : resolveGroup(groupById.get(group.parentId)!).worldMatrix;
    const world = parentWorld.clone().multiply(local);
    const resolved = buildResolvedNode(group, "group", local, world);
    resolvedGroups.set(group.id, resolved);
    return resolved;
  };
  for (const group of groups) resolveGroup(group);

  const resolvedEntities = new Map<string, ResolvedSceneNode>();
  for (const entity of entities) {
    const local = composeLocalMatrix(entity);
    const parentWorld =
      entity.parentId === undefined || entity.parentId === null
        ? new Matrix4()
        : resolvedGroups.get(entity.parentId)!.worldMatrix;
    const world = parentWorld.clone().multiply(local);
    resolvedEntities.set(
      entity.id,
      buildResolvedNode(entity, "entity", local, world),
    );
  }

  const nodes = new Map<string, ResolvedSceneNode>();
  for (const [id, node] of resolvedGroups) nodes.set(id, node);
  for (const [id, node] of resolvedEntities) nodes.set(id, node);
  return {
    groups: resolvedGroups,
    entities: resolvedEntities,
    nodes,
    get: (id: string) => nodes.get(id),
  };
}

function validateBounds(bounds: LocalBounds): void {
  if (!bounds || typeof bounds !== "object") fail("Bounds must be an object.");
  validateVec3(bounds.min, "Bounds min");
  validateVec3(bounds.max, "Bounds max");
  for (let axis = 0; axis < 3; axis++)
    if (bounds.min[axis] > bounds.max[axis])
      fail("Bounds min must not exceed bounds max.");
}

/** Transform all eight local AABB corners and return the conservative world AABB. */
export function transformBounds(
  matrix: Matrix4,
  bounds: LocalBounds,
): WorldBounds {
  matrixElements(matrix, "Bounds matrix");
  validateBounds(bounds);
  const min = new Vector3(Infinity, Infinity, Infinity);
  const max = new Vector3(-Infinity, -Infinity, -Infinity);
  for (const x of [bounds.min[0], bounds.max[0]]) {
    for (const y of [bounds.min[1], bounds.max[1]]) {
      for (const z of [bounds.min[2], bounds.max[2]]) {
        const corner = new Vector3(x, y, z).applyMatrix4(matrix);
        if (![corner.x, corner.y, corner.z].every(Number.isFinite))
          fail("Bounds transform produced a nonfinite corner.");
        min.min(corner);
        max.max(corner);
      }
    }
  }
  return { min: vec3Tuple(min), max: vec3Tuple(max) };
}

/**
 * Set a scene/root-space position while preserving every linear matrix entry.
 * This intentionally does not decompose or recompose the matrix.
 */
export function applyRootPositionOverride(
  worldMatrix: Matrix4,
  position: Vec3,
): Matrix4 {
  matrixElements(worldMatrix, "Root-space override matrix");
  validateVec3(position, "Root-space override position");
  const next = worldMatrix.clone();
  next.setPosition(new Vector3(...position));
  matrixElements(next, "Root-space override result");
  return next;
}

function matricesClose(a: Matrix4, b: Matrix4, tolerance: number): boolean {
  const aElements = matrixElements(a, "Matrix A");
  const bElements = matrixElements(b, "Matrix B");
  return aElements.every((value, index) => {
    const scale = Math.max(1, Math.abs(value), Math.abs(bElements[index]));
    return Math.abs(value - bElements[index]) <= tolerance * scale;
  });
}

/**
 * Compute local TRS for a keep-world reparent. The operation rejects singular
 * matrices and any shear that cannot be represented by XYZ Euler TRS within
 * SCENE_TRANSFORM_TOLERANCE (or the supplied tolerance).
 */
export function computeKeepWorldLocalTRS(
  oldWorldMatrix: Matrix4,
  newParentWorldMatrix?: Matrix4 | null,
  options: KeepWorldTransformOptions = {},
): LocalTRS {
  const tolerance = options.tolerance ?? SCENE_TRANSFORM_TOLERANCE;
  if (!Number.isFinite(tolerance) || tolerance < 0)
    fail("Keep-world transform tolerance must be a finite nonnegative number.");
  matrixElements(oldWorldMatrix, "Old world matrix");
  const parent = newParentWorldMatrix ?? new Matrix4();
  matrixElements(parent, "New parent world matrix");
  const oldWorldDeterminant = oldWorldMatrix.determinant();
  if (!Number.isFinite(oldWorldDeterminant) || oldWorldDeterminant === 0)
    fail("Keep-world transform cannot decompose a singular old world matrix.");
  const parentDeterminant = parent.determinant();
  if (!Number.isFinite(parentDeterminant) || parentDeterminant === 0)
    fail("Keep-world transform cannot invert a singular new parent matrix.");

  const parentInverse = invertAffineMatrix(parent, "New parent inverse matrix");
  const localMatrix = parentInverse.multiply(oldWorldMatrix);
  matrixElements(localMatrix, "Keep-world local matrix");
  const localDeterminant = localMatrix.determinant();
  if (!Number.isFinite(localDeterminant) || localDeterminant === 0)
    fail("Keep-world transform cannot decompose a singular local matrix.");

  const position = new Vector3();
  const quaternion = new Quaternion();
  const scale = new Vector3();
  localMatrix.decompose(position, quaternion, scale);
  if (
    ![position.x, position.y, position.z, scale.x, scale.y, scale.z].every(
      Number.isFinite,
    )
  )
    fail("Keep-world transform decomposed to nonfinite TRS values.");
  const rotation = new Euler().setFromQuaternion(quaternion, "XYZ");
  const reconstructed = new Matrix4().compose(
    position,
    new Quaternion().setFromEuler(rotation),
    scale,
  );
  if (!matricesClose(localMatrix, reconstructed, tolerance))
    fail(
      "Keep-world transform requires shear that cannot be represented by local XYZ TRS.",
    );
  const reconstructedWorld = parent.clone().multiply(reconstructed);
  if (!matricesClose(oldWorldMatrix, reconstructedWorld, tolerance))
    fail("Keep-world transform did not preserve the old world matrix.");
  return {
    position: vec3Tuple(position),
    rotation: [rotation.x, rotation.y, rotation.z],
    scale: vec3Tuple(scale),
  };
}
