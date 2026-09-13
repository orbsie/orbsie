"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useOrb } from "@/lib/store";
import { entityGeometry } from "@/lib/geometry";
import { useAssetGeometry } from "@/lib/use-asset-geometry";
import { useGeneratedGeometry } from "@/lib/use-generated-geometry";
import { isAssetId } from "@/lib/asset-catalog";
import {
  isTextEntryTarget,
  movingEntityPosition,
  stepGameplay,
  type PlayerState,
} from "@/lib/gameplay";
import {
  gameplayObservationRequested,
  publishGameplayObservation,
} from "@/lib/gameplay-observation";
import {
  PlayerInputTracker,
  actionForPlayerKey,
  type PlayerInputDetail,
} from "@/lib/player-input";
import { GameSession, GAME_RULES_RESTART_NOTICE } from "@/lib/game-session";
import {
  resolveRuntimeScene,
  runtimeEntityMatrix,
  usesSceneHierarchy,
} from "@/lib/scene-runtime";
import {
  sampleTexture,
  type FormationTextureSample,
} from "@/lib/formation-particles";
import type { Entity, Project } from "@/lib/protocol";

export type SoftwareGeometryEntry = {
  geometry: THREE.BufferGeometry;
  tint?: string;
  ready: boolean;
  /** The recipe/stage that produced this geometry. Keep these paired while a
   * replacement asset is still loading so collision uses the displayed mesh. */
  sourceRecipe: Entity["geometry"];
  sourceStage: Entity["stage"];
};

type SoftwareWorldProps = {
  onReady?: () => void;
  onRendererReady?: (renderer?: "software") => void;
  onError?: (message: string) => void;
};

const softwareRendererError =
  "This browser could not start its 2D graphics fallback. Your world needs a browser with canvas support.";
const softwareFallbackWarning =
  "WebGL2 could not initialize, so Orbsie is using its software canvas renderer.";
const playerStart: PlayerState = { position: [0, 0.5, 5], velocityY: 0 };

function copyPlayerState(value: PlayerState): PlayerState {
  return {
    ...value,
    position: [...value.position] as [number, number, number],
    supportPosition: value.supportPosition
      ? ([...value.supportPosition] as [number, number, number])
      : undefined,
    supportMatrix: value.supportMatrix ? [...value.supportMatrix] : undefined,
  };
}

function toSrgb(value: number): number {
  const linear = Math.max(0, Math.min(1, value));
  return Math.round(
    (linear <= 0.0031308
      ? linear * 12.92
      : 1.055 * Math.pow(linear, 1 / 2.4) - 0.055) * 255,
  );
}

function cssColor(rgb: readonly [number, number, number], alpha = 1): string {
  return `rgb(${toSrgb(rgb[0])} ${toSrgb(rgb[1])} ${toSrgb(rgb[2])} / ${alpha})`;
}

function readColor(
  attribute:
    THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined,
  index: number,
): [number, number, number] {
  if (!attribute || index >= attribute.count) return [1, 1, 1];
  return [attribute.getX(index), attribute.getY(index), attribute.getZ(index)];
}

function textureSample(
  texture: THREE.DataTexture,
): FormationTextureSample | undefined {
  const image = texture.image;
  const pixels = image?.data;
  if (
    !(pixels instanceof Uint8Array) ||
    !Number.isSafeInteger(image?.width) ||
    !Number.isSafeInteger(image?.height) ||
    image.width <= 0 ||
    image.height <= 0 ||
    pixels.byteLength !== image.width * image.height * 4 ||
    !["", "srgb", "srgb-linear"].includes(texture.colorSpace)
  )
    return undefined;
  return {
    pixels,
    width: image.width,
    height: image.height,
    colorSpace: texture.colorSpace as FormationTextureSample["colorSpace"],
    wrapS: texture.wrapS,
    wrapT: texture.wrapT,
    magFilter: texture.magFilter,
    minFilter: texture.minFilter,
  };
}

/** Bake a bounded atlas approximation into committed software vertex colors. */
export function bakeSoftwareTextureColors(
  geometry: THREE.BufferGeometry,
  texture: THREE.DataTexture | undefined,
): THREE.BufferGeometry {
  if (!texture) return geometry;
  const sample = textureSample(texture);
  const position = geometry.getAttribute("position");
  const uv = geometry.getAttribute("uv");
  if (!sample || !position || !uv || uv.itemSize < 2) return geometry;
  const sourceColors = geometry.getAttribute("color");
  const colors = new Float32Array(position.count * 3);
  for (let index = 0; index < position.count; index++) {
    const source = readColor(sourceColors, index);
    const sampled =
      index < uv.count &&
      Number.isFinite(uv.getX(index)) &&
      Number.isFinite(uv.getY(index))
        ? sampleTexture(sample, [uv.getX(index), uv.getY(index)])
        : ([1, 1, 1] as const);
    colors[index * 3] = source[0] * sampled[0];
    colors[index * 3 + 1] = source[1] * sampled[1];
    colors[index * 3 + 2] = source[2] * sampled[2];
  }
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  return geometry;
}

function makeEntityGeometry(entity: Entity): SoftwareGeometryEntry {
  const geometry = entityGeometry(
    entity.geometry?.kind === "asset" || entity.geometry?.kind === "generated"
      ? { ...entity, geometry: undefined }
      : entity,
  );
  return {
    geometry,
    ready:
      entity.geometry?.kind !== "asset" &&
      entity.geometry?.kind !== "generated",
    sourceRecipe: entity.geometry,
    sourceStage: entity.stage,
  };
}

function SoftwareEntity({
  entity,
  onChange,
}: {
  entity: Entity;
  onChange: (
    id: string,
    entry: SoftwareGeometryEntry | undefined,
    disposed?: THREE.BufferGeometry,
  ) => boolean;
}) {
  const recipe =
    entity.geometry?.kind === "asset" || entity.geometry?.kind === "generated"
      ? entity.geometry
      : undefined;
  const catalog = useAssetGeometry(
    recipe?.kind === "asset" && isAssetId(recipe.assetId)
      ? recipe.assetId
      : undefined,
  );
  const generated = useGeneratedGeometry(
    recipe?.kind === "generated" ? recipe.model?.sha256 : undefined,
  );
  const loaded = recipe?.kind === "generated" ? generated : catalog;
  const loadedTexture = recipe?.kind === "asset" ? catalog?.texture : undefined;
  useEffect(() => {
    if (loaded?.error)
      useOrb.getState().set({ error: `${entity.label}: ${loaded.error}` });
  }, [entity.label, loaded?.error]);
  useEffect(() => {
    // Clone/build only after React commits this entity. That keeps discarded
    // concurrent renders from allocating geometries that have no owner.
    const geometry = loaded?.geometry?.clone();
    const entry = geometry
      ? {
          geometry: bakeSoftwareTextureColors(geometry, loadedTexture),
          tint: recipe?.tint,
          ready: true,
          sourceRecipe: entity.geometry,
          sourceStage: entity.stage,
        }
      : makeEntityGeometry(entity);
    const accepted = onChange(entity.id, entry);
    return () => {
      // Removal is owned by the component-unmount effect below. On a recipe
      // change this entry must remain available until the replacement effect
      // commits; otherwise a pending replacement would blank the last-good
      // mesh and collision shape.
      if (!entry.ready && accepted)
        onChange(entity.id, undefined, entry.geometry);
    };
  }, [
    entity.id,
    entity.geometry,
    entity.color,
    entity.stage,
    loaded?.geometry,
    loadedTexture,
    onChange,
    recipe?.tint,
  ]);
  useEffect(() => {
    return () => {
      onChange(entity.id, undefined);
    };
  }, [entity.id, onChange]);
  return null;
}

type ProjectedPoint = { x: number; y: number; z: number };
type PickedEntity = { id: string; x: number; y: number; radius: number };
type SoftwareMarker = { entity: Entity; point: ProjectedPoint };
type SoftwareFace = {
  points: [ProjectedPoint, ProjectedPoint, ProjectedPoint];
  color: string;
  depth: number;
};

function projectPoint(
  point: THREE.Vector3,
  matrix: THREE.Matrix4,
  camera: THREE.PerspectiveCamera,
  width: number,
  height: number,
): ProjectedPoint {
  const projected = point.clone().applyMatrix4(matrix).project(camera);
  return {
    x: (projected.x * 0.5 + 0.5) * width,
    y: (-projected.y * 0.5 + 0.5) * height,
    z: projected.z,
  };
}

function entityMatrix(
  project: Project,
  entity: Entity,
  time: number,
  session: GameSession,
  playing: boolean,
): THREE.Matrix4 {
  const override = playing
    ? session.state?.entityOverrides[entity.id]
    : undefined;
  if (usesSceneHierarchy(project))
    return runtimeEntityMatrix(
      resolveRuntimeScene(project),
      entity,
      time,
      override?.position,
    );
  const effective = playing ? session.effectiveEntity(entity) ?? entity : entity;
  const position = movingEntityPosition(effective, time);
  if (override?.position) position.splice(0, 3, ...override.position);
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...position),
    new THREE.Quaternion().setFromEuler(
      new THREE.Euler(...(entity.rotation ?? [0, 0, 0])),
    ),
    new THREE.Vector3(...entity.scale),
  );
}

function drawEntity(
  entry: SoftwareGeometryEntry,
  entity: Entity,
  matrix: THREE.Matrix4,
  camera: THREE.PerspectiveCamera,
  width: number,
  height: number,
  selected: boolean,
  collected: boolean,
  pick: PickedEntity[],
  faces: SoftwareFace[],
  markers: SoftwareMarker[],
  colorOverride?: string,
) {
  if (collected && entity.behavior?.type === "collect") return;
  const geometry = entry.geometry;
  const position = geometry.getAttribute("position");
  if (!position) return;
  const colors = geometry.getAttribute("color");
  const index = geometry.index;
  const triangles = Math.floor((index?.count ?? position.count) / 3);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const view = camera.matrixWorldInverse;
  for (let triangle = 0; triangle < triangles; triangle++) {
    const ia = index?.getX(triangle * 3) ?? triangle * 3;
    const ib = index?.getX(triangle * 3 + 1) ?? triangle * 3 + 1;
    const ic = index?.getX(triangle * 3 + 2) ?? triangle * 3 + 2;
    a.set(position.getX(ia), position.getY(ia), position.getZ(ia));
    b.set(position.getX(ib), position.getY(ib), position.getZ(ib));
    c.set(position.getX(ic), position.getY(ic), position.getZ(ic));
    const pa = projectPoint(a, matrix, camera, width, height);
    const pb = projectPoint(b, matrix, camera, width, height);
    const pc = projectPoint(c, matrix, camera, width, height);
    const ca = readColor(colors, ia);
    const cb = readColor(colors, ib);
    const cc = readColor(colors, ic);
    let rgb: [number, number, number] = [
      (ca[0] + cb[0] + cc[0]) / 3,
      (ca[1] + cb[1] + cc[1]) / 3,
      (ca[2] + cb[2] + cc[2]) / 3,
    ];
    if (colorOverride) {
      const color = new THREE.Color(colorOverride);
      rgb = [color.r, color.g, color.b];
    } else if (entry.tint) {
      const tint = new THREE.Color(entry.tint);
      rgb = [tint.r, tint.g, tint.b];
    }
    const depth =
      (a.clone().applyMatrix4(matrix).applyMatrix4(view).z +
        b.clone().applyMatrix4(matrix).applyMatrix4(view).z +
        c.clone().applyMatrix4(matrix).applyMatrix4(view).z) /
      3;
    faces.push({
      points: [pa, pb, pc],
      color: cssColor(rgb),
      depth,
    });
  }
  const center = projectPoint(
    new THREE.Vector3(0, 0.65, 0),
    matrix,
    camera,
    width,
    height,
  );
  pick.push({ id: entity.id, x: center.x, y: center.y, radius: 32 });
  if (selected || entity.behavior?.type === "portal")
    markers.push({ entity, point: center });
}

function drawPlayer(
  ctx: CanvasRenderingContext2D,
  state: PlayerState,
  camera: THREE.PerspectiveCamera,
  width: number,
  height: number,
) {
  const matrix = new THREE.Matrix4().makeTranslation(...state.position);
  const point = projectPoint(
    new THREE.Vector3(0, 0.4, 0),
    matrix,
    camera,
    width,
    height,
  );
  ctx.beginPath();
  ctx.arc(point.x, point.y, 10, 0, Math.PI * 2);
  ctx.fillStyle = "#fff8db";
  ctx.fill();
  ctx.strokeStyle = "#3a665c";
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(point.x + 3, point.y - 2, 3, 0, Math.PI * 2);
  ctx.fillStyle = "#3a665c";
  ctx.fill();
}

export function playableEntities(
  project: Project,
  geometries: Map<string, SoftwareGeometryEntry>,
): Entity[] {
  return project.entities.map((entity) => {
    const entry = geometries.get(entity.id);
    if (
      (entity.geometry?.kind === "asset" ||
        entity.geometry?.kind === "generated") &&
      !entry?.ready
    )
      return { ...entity, stage: "seed" as const };
    if (
      (entity.geometry?.kind === "asset" ||
        entity.geometry?.kind === "generated") &&
      entry?.ready
    )
      return {
        ...entity,
        geometry: entry.sourceRecipe ?? entity.geometry,
        stage: entry.sourceStage,
      };
    return entity;
  });
}

export function requiredGeometryReady(
  project: Project,
  geometries: Map<string, SoftwareGeometryEntry>,
): boolean {
  return project.entities.every((entity) => {
    if (
      entity.geometry?.kind !== "asset" &&
      entity.geometry?.kind !== "generated"
    )
      return true;
    const entry = geometries.get(entity.id);
    return (
      entry?.ready === true &&
      entry.sourceRecipe === entity.geometry
    );
  });
}

function drawScene(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  project: Project,
  geometries: Map<string, SoftwareGeometryEntry>,
  session: GameSession,
  player: PlayerState,
  selected: string | undefined,
  score: readonly string[],
  time: number,
  camera: THREE.PerspectiveCamera,
  picks: PickedEntity[],
) {
  const width = canvas.clientWidth || 1;
  const height = canvas.clientHeight || 1;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (
    canvas.width !== Math.round(width * dpr) ||
    canvas.height !== Math.round(height * dpr)
  ) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  const gradient = ctx.createRadialGradient(
    width * 0.48,
    height * 0.34,
    10,
    width * 0.48,
    height * 0.5,
    Math.max(width, height),
  );
  gradient.addColorStop(0, "#faf8e8");
  gradient.addColorStop(0.55, "#e7efe3");
  gradient.addColorStop(1, "#d8eae6");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "rgba(93, 146, 122, .1)";
  ctx.beginPath();
  ctx.ellipse(
    width / 2,
    height * 0.72,
    width * 0.4,
    height * 0.12,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  camera.aspect = width / Math.max(1, height);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  picks.length = 0;
  const faces: SoftwareFace[] = [];
  const markers: SoftwareMarker[] = [];
  const playing = useOrb.getState().playing;
  for (const entity of project.entities) {
    const effective = playing ? session.effectiveEntity(entity) : entity;
    if (!effective) continue;
    const entry = geometries.get(entity.id);
    if (!entry) continue;
    drawEntity(
      entry,
      effective,
      entityMatrix(project, entity, time, session, playing),
      camera,
      width,
      height,
      selected === entity.id,
      playing && score.includes(entity.id),
      picks,
      faces,
      markers,
      playing ? session.state?.entityOverrides[entity.id]?.color : undefined,
    );
  }
  faces.sort((left, right) => left.depth - right.depth);
  for (const face of faces) {
    ctx.beginPath();
    ctx.moveTo(face.points[0].x, face.points[0].y);
    ctx.lineTo(face.points[1].x, face.points[1].y);
    ctx.lineTo(face.points[2].x, face.points[2].y);
    ctx.closePath();
    ctx.fillStyle = face.color;
    ctx.fill();
  }
  for (const marker of markers) {
    if (marker.entity.id === selected) {
      ctx.beginPath();
      ctx.arc(marker.point.x, marker.point.y, 27, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(255, 248, 204, .95)";
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    if (marker.entity.behavior?.type === "portal") {
      ctx.beginPath();
      ctx.arc(marker.point.x, marker.point.y - 20, 19, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(189, 237, 207, .85)";
      ctx.lineWidth = 3;
      ctx.stroke();
    }
  }
  if (playing) drawPlayer(ctx, player, camera, width, height);
}

export default function SoftwareWorld({
  onReady,
  onRendererReady,
  onError,
}: SoftwareWorldProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const geometriesRef = useRef(new Map<string, SoftwareGeometryEntry>());
  const disposedGeometriesRef = useRef(new WeakSet<THREE.BufferGeometry>());
  const [, setGeometryVersion] = useState(0);
  const geometryChange = useMemo(
    () =>
      (
        id: string,
        entry: SoftwareGeometryEntry | undefined,
        disposed?: THREE.BufferGeometry,
      ): boolean => {
        const disposeOnce = (geometry: THREE.BufferGeometry) => {
          if (disposedGeometriesRef.current.has(geometry)) return;
          disposedGeometriesRef.current.add(geometry);
          geometry.dispose();
        };
        const current = geometriesRef.current.get(id);
        if (entry && !entry.ready && current?.ready) {
          // Keep the committed last-good shape during an asynchronous asset
          // replacement. The pending clone has no owner once it is rejected.
          disposeOnce(entry.geometry);
          return false;
        }
        if (disposed && current?.geometry === disposed) {
          geometriesRef.current.delete(id);
          disposeOnce(disposed);
        } else if (disposed && current?.geometry !== disposed) {
          // A stale cleanup may arrive after a replacement has committed.
          disposeOnce(disposed);
        }
        if (entry && (!current || current.geometry !== entry.geometry)) {
          if (current && current.geometry !== entry.geometry)
            disposeOnce(current.geometry);
          geometriesRef.current.set(id, entry);
          setGeometryVersion((version) => version + 1);
          return true;
        }
        if (!entry && !disposed && current) {
          geometriesRef.current.delete(id);
          disposeOnce(current.geometry);
          setGeometryVersion((version) => version + 1);
          return true;
        }
        setGeometryVersion((version) => version + 1);
        return false;
      },
    [],
  );
  const project = useOrb((state) => state.project);
  const selected = useOrb((state) => state.selected);
  const score = useOrb((state) => state.score);
  const reset = useOrb((state) => state.reset);
  const session = useMemo(() => new GameSession(), []);
  const playerRef = useRef<PlayerState>(copyPlayerState(playerStart));
  const inputRef = useRef(new PlayerInputTracker());
  const announcedReady = useRef(false);
  const rendererReady = useRef(false);
  const picksRef = useRef<PickedEntity[]>([]);
  const generationRef = useRef(-1);
  const previousReset = useRef(reset);
  const previousProjectId = useRef(project.id);
  const onReadyRef = useRef(onReady);
  const onRendererReadyRef = useRef(onRendererReady);
  const onErrorRef = useRef(onError);
  onReadyRef.current = onReady;
  onRendererReadyRef.current = onRendererReady;
  onErrorRef.current = onError;

  useEffect(
    () => () => {
      for (const entry of geometriesRef.current.values()) {
        if (disposedGeometriesRef.current.has(entry.geometry)) continue;
        disposedGeometriesRef.current.add(entry.geometry);
        entry.geometry.dispose();
      }
      geometriesRef.current.clear();
    },
    [],
  );

  /* __ORBSIE_SOFTWARE_WORLD_FIXTURE_PROBE__ */

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let context: CanvasRenderingContext2D | null;
    try {
      context = canvas.getContext("2d", { alpha: true });
    } catch {
      onErrorRef.current?.(softwareRendererError);
      return;
    }
    if (!context) {
      onErrorRef.current?.(softwareRendererError);
      return;
    }
    if (!rendererReady.current) {
      rendererReady.current = true;
      onRendererReadyRef.current?.("software");
    }
    const camera = new THREE.PerspectiveCamera(43, 1, 0.1, 250);
    camera.position.set(0, 1.8, 10.4);
    camera.lookAt(0, 1, 0);
    camera.updateMatrixWorld();
    let frame = 0;
    let last = performance.now();
    let stopped = false;
    const reportRuntimeError = () => {
      if (stopped) return;
      stopped = true;
      cancelAnimationFrame(frame);
      onErrorRef.current?.(softwareRendererError);
    };
    const animate = (now: number) => {
      if (stopped) return;
      try {
        const delta = Math.min(0.04, Math.max(0, (now - last) / 1000));
        last = now;
        const current = useOrb.getState();
        const projectNow = current.project;
        if (
          previousReset.current !== current.reset ||
          previousProjectId.current !== projectNow.id
        ) {
          playerRef.current = copyPlayerState(playerStart);
          inputRef.current.clear();
          previousReset.current = current.reset;
          previousProjectId.current = projectNow.id;
        }
        const rulesChanged = session.sync(
          projectNow.id,
          projectNow.game,
          current.reset,
        );
        if (current.playing && rulesChanged)
          current.set({
            notice: GAME_RULES_RESTART_NOTICE,
            ruleRestartCount: current.ruleRestartCount + 1,
          });
        const resetAvatar = () => {
          if (generationRef.current === session.resetGeneration) return false;
          generationRef.current = session.resetGeneration;
          playerRef.current = copyPlayerState(playerStart);
          useOrb.getState().set({
            score: [],
            gameScore: 0,
            won: false,
            lost: false,
          });
          return true;
        };
        resetAvatar();
        if (current.playing) {
          const pressed = inputRef.current.consumePressed();
          for (const action of pressed) session.queueInput(action);
          session.advance(delta);
          // Input/start/tick actions can run a reset rule. Reconcile that
          // generation before physics and use the post-reset store score.
          const didAdvanceReset = resetAvatar();
          const afterAdvance = useOrb.getState();
          const rawX =
            (inputRef.current.isHeld("right") ? 1 : 0) -
            (inputRef.current.isHeld("left") ? 1 : 0);
          const rawZ =
            (inputRef.current.isHeld("down") ? 1 : 0) -
            (inputRef.current.isHeld("up") ? 1 : 0);
          const directionVector = new THREE.Vector3(rawX, 0, rawZ);
          if (directionVector.lengthSq())
            directionVector
              .applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.5)
              .normalize();
          const direction = {
            x: directionVector.x,
            z: directionVector.z,
            jump: inputRef.current.isHeld("jump") || pressed.includes("jump"),
          };
          const matrices = usesSceneHierarchy(projectNow)
            ? new Map(
                projectNow.entities.map((entity) => [
                  entity.id,
                  runtimeEntityMatrix(
                    resolveRuntimeScene(projectNow),
                    entity,
                    now / 1000,
                    session.state?.entityOverrides[entity.id]?.position,
                  ),
                ]),
              )
            : undefined;
          const playable = playableEntities(projectNow, geometriesRef.current)
            .map((entity) => session.effectiveEntity(entity))
            .filter((entity): entity is Entity => entity !== null);
          const result = stepGameplay(
            playerRef.current,
            direction,
            playable,
            didAdvanceReset ? [] : afterAdvance.score,
            now / 1000,
            session.state && session.state.status !== "playing" ? 0 : delta,
            session.collisionTargets,
            matrices,
          );
          playerRef.current = result;
          const beforeContacts = session.resetGeneration;
          session.emitContacts(result.contacts);
          if (session.resetGeneration === beforeContacts)
            session.emitCollections(result.collected);
          const didReset = resetAvatar();
          const next = useOrb.getState();
          if (
            !didReset &&
            (next.score.length !== result.collected.length ||
              result.collected.some((id, i) => next.score[i] !== id))
          )
            next.set({ score: result.collected });
          if (session.state) {
            const won = session.state.status === "won";
            const lost = session.state.status === "lost";
            if (
              next.gameScore !== session.state.score ||
              next.won !== won ||
              next.lost !== lost
            )
              next.set({ gameScore: session.state.score, won, lost });
          } else if (result.won && !next.won) next.set({ won: true });
          if (gameplayObservationRequested()) {
            const observedEntities = playable.map((entity) => {
              const matrix = matrices?.get(entity.id);
              const position = matrix
                ? ([
                    matrix.elements[12],
                    matrix.elements[13],
                    matrix.elements[14],
                  ] as [number, number, number])
                : movingEntityPosition(entity, now / 1000);
              return {
                id: entity.id,
                behavior: entity.behavior?.type ?? null,
                stage: entity.stage,
                position,
                scale: [...entity.scale] as [number, number, number],
              };
            });
            const latest = useOrb.getState();
            publishGameplayObservation({
              renderer: "software",
              projectId: latest.project.id,
              revision: latest.project.revision,
              simulationDeltaMs: delta * 1000,
              playing: latest.playing,
              player: playerRef.current,
              entities: observedEntities,
              contacts: result.contacts,
              platformContactId: result.platformContactId,
              bounceContactId: result.bounceContactId,
              collected: result.collected,
              scoreIds: latest.score,
              gameScore: latest.gameScore,
              status: session.state?.status ?? null,
              won: latest.won,
              lost: latest.lost,
              reset: latest.reset,
              sessionGeneration: session.resetGeneration,
            });
          }
        } else inputRef.current.clear();
        drawScene(
          context,
          canvas,
          projectNow,
          geometriesRef.current,
          session,
          playerRef.current,
          current.selected,
          useOrb.getState().score,
          now / 1000,
          camera,
          picksRef.current,
        );
        if (
          current.playing &&
          !announcedReady.current &&
          requiredGeometryReady(projectNow, geometriesRef.current)
        ) {
          announcedReady.current = true;
          onReadyRef.current?.();
        }
        frame = requestAnimationFrame(animate);
      } catch {
        reportRuntimeError();
      }
    };
    try {
      frame = requestAnimationFrame(animate);
    } catch {
      reportRuntimeError();
    }
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      inputRef.current.clear();
    };
  }, []);

  useEffect(() => {
    const legacyPointerIds = new Map<string, number | string>();
    const key = (event: KeyboardEvent, down: boolean) => {
      const buttonActivation =
        (event.target as Element)?.closest("button") &&
        [" ", "Enter"].includes(event.key);
      if (down && (isTextEntryTarget(event.target) || buttonActivation)) return;
      const action = actionForPlayerKey(event.key);
      if (down && action) event.preventDefault();
      inputRef.current.setKeyboard(event.key, down);
    };
    const down = (event: KeyboardEvent) => key(event, true);
    const up = (event: KeyboardEvent) => key(event, false);
    const blur = () => {
      inputRef.current.clear();
      legacyPointerIds.clear();
    };
    const focus = (event: FocusEvent) => {
      if (isTextEntryTarget(event.target)) blur();
    };
    const hidden = () => {
      if (document.visibilityState === "hidden") blur();
    };
    const pointer = (event: Event) => {
      const detail = (event as CustomEvent<PlayerInputDetail>).detail;
      if (
        typeof detail?.key === "string" &&
        (detail.pointerId === undefined || Number.isInteger(detail.pointerId))
      ) {
        const key = detail.key.toLowerCase();
        const pointerId =
          detail.pointerId ?? legacyPointerIds.get(key) ?? `legacy:${key}`;
        if (detail.pointerId === undefined && detail.down)
          legacyPointerIds.set(key, pointerId);
        inputRef.current.setPointer(
          pointerId,
          detail.key,
          Boolean(detail.down),
        );
        if (detail.pointerId === undefined && !detail.down)
          legacyPointerIds.delete(key);
      }
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    window.addEventListener("pagehide", blur);
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("focusin", focus);
    window.addEventListener("orbsie-input", pointer);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
      window.removeEventListener("pagehide", blur);
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("focusin", focus);
      window.removeEventListener("orbsie-input", pointer);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const pointerStarts = new Map<number, { x: number; y: number }>();
    const pointerDown = (event: PointerEvent) => {
      pointerStarts.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY,
      });
    };
    const click = (event: PointerEvent) => {
      const start = pointerStarts.get(event.pointerId);
      pointerStarts.delete(event.pointerId);
      if (
        start &&
        Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8
      )
        return;
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const hit = [...picksRef.current]
        .reverse()
        .find(
          (candidate) =>
            Math.hypot(candidate.x - x, candidate.y - y) < candidate.radius,
        );
      if (!hit) return;
      const current = useOrb.getState();
      if (current.playing) session.queueClick(hit.id);
      else current.set({ selected: hit.id });
    };
    const cancel = (event: PointerEvent) =>
      pointerStarts.delete(event.pointerId);
    canvas.addEventListener("pointerdown", pointerDown);
    canvas.addEventListener("pointerup", click);
    canvas.addEventListener("pointercancel", cancel);
    return () => {
      canvas.removeEventListener("pointerdown", pointerDown);
      canvas.removeEventListener("pointerup", click);
      canvas.removeEventListener("pointercancel", cancel);
    };
  }, [session]);

  return (
    <div className="software-world" aria-label="Software world renderer">
      <canvas ref={canvasRef} />
      {project.entities.map((entity) => (
        <SoftwareEntity
          key={entity.id}
          entity={entity}
          onChange={geometryChange}
        />
      ))}
      <p className="software-world-status" aria-live="polite">
        {softwareFallbackWarning}
      </p>
    </div>
  );
}
