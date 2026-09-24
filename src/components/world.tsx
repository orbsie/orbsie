"use client";
import {
  Canvas,
  useFrame,
  useThree,
  type ThreeEvent,
} from "@react-three/fiber";
import { ContactShadows, Stars } from "@react-three/drei";
import { Minus, Plus, Scan } from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useCallback,
  useMemo,
  useRef,
  useState,
  Component,
  type ReactNode,
} from "react";
import * as THREE from "three";
import { useOrb } from "@/lib/store";
import {
  resolveRuntimeScene,
  runtimeEntityMatrix,
  usesSceneHierarchy,
} from "@/lib/scene-runtime";
import type { ResolvedScene } from "@/lib/scene-transform";
import {
  markExperience,
  markVisibleSeed,
  markSceneUpdateDraw,
  hasExperienceMilestone,
} from "@/lib/experience-metrics";
import { collectGameProgramEntityIds } from "@/lib/game-program";
import { formationParticles } from "@/lib/formation-particles";
import { registerPublicationThumbnail } from "@/lib/publication-thumbnail";
import {
  notifySceneReviewCaptureChanged,
  captureSceneReview,
  captureSceneCanvas,
  registerSceneReviewCaptureSource,
  type SceneReviewSourceState,
} from "@/lib/scene-review-capture";
import type { Entity, Project } from "@/lib/protocol";
import { GameSession, GAME_RULES_RESTART_NOTICE } from "@/lib/game-session";
import {
  PlayerInputTracker,
  actionForPlayerKey,
  type PlayerInputDetail,
  type PlayerInputLatencySnapshot,
} from "@/lib/player-input";
import { useAssetGeometry } from "@/lib/use-asset-geometry";
import { useGeneratedGeometry } from "@/lib/use-generated-geometry";
import { isAssetId } from "@/lib/asset-catalog";
import { maximumRenderDpr, RenderBudget } from "@/lib/render-budget";
import {
  createWorldNavigationState,
  applyWorldNavigationCommand,
  worldNavigationCameraPose,
  worldNavigationFarPlane,
  worldNavigationFollowState,
  worldNavigationLandingLookTarget,
  worldNavigationProjectState,
  type WorldNavigationProjectState,
  type WorldNavigationCommand,
  type WorldNavigationVec3,
  type WorldNavigationBounds,
  WORLD_NAVIGATION_DEFAULT_DISTANCE,
} from "@/lib/world-navigation";
import {
  initialProjectFrameSettlement,
  isInitialProjectFrameBuildStart,
  type InitialProjectFrameAttempt,
  type InitialProjectFrameLifecycle,
} from "@/lib/initial-project-frame";
import {
  selectRenderOrigin,
  worldCameraPoseToRenderLocal,
  type RenderOriginVec3,
} from "@/lib/render-origin";
import {
  committedWorldNavigationBounds,
  worldNavigationBoundsByEntity,
  type WorldNavigationEntityBounds,
} from "@/lib/world-navigation-bounds";
import { selectVisibleWorldEntityIds } from "@/lib/world-visibility";
import { WorldNavigationGestureController } from "@/lib/world-navigation-gestures";
import {
  formationProxyReviewSnapshot,
  playbackFormationResidencyFocusCell,
  formationProxyVisualBounds,
  selectFormationResidencyPresentation,
  type FormationProxyVisualBounds,
} from "@/lib/formation-residency-presentation";
import {
  formationCanHydrateComplete,
  formationRecipeIdentity,
  formationResourceMatchesRecipe,
  markFormationComplete,
  reconcileFormationCompletionRecords,
  type FormationCompletionRecords,
} from "@/lib/formation-completion";
import {
  sampleWorldTerrainChunk,
  selectWorldTerrainChunks,
  worldTerrainChunkKeyAt,
  worldTerrainChunkSize,
  worldTerrainGroundViewRadius,
  type WorldTerrainChunkKey,
} from "@/lib/world-terrain";
import {
  entityGeometry,
  addFormationSource,
  captureFormationSnapshot,
  terrainValue,
} from "@/lib/geometry";
import {
  isTextEntryTarget,
  movingEntityPosition,
  playerSpawnForProject,
  registerContactBounds,
  stepGameplay,
  type PlayerState,
} from "@/lib/gameplay";
import {
  displayedGameplayRecipeMatchesCurrent,
  displayedGameplayRecipeScopeForProject,
  gameplayEntityFromDisplayedRecipe,
  recordDisplayedGameplayRecipe,
  type DisplayedGameplayRecipeRegistry,
  type DisplayedGameplayRecipeScope,
} from "@/lib/gameplay-visual-authority";
import {
  gameplayObservationRequested,
  publishGameplayObservation,
} from "@/lib/gameplay-observation";
import {
  globeOffsetY,
  globeScale,
  parcelFrame,
  patchBlend,
  parcelTransitionController,
  type ParcelFrame,
} from "@/lib/parcel-transition";
import SoftwareWorld from "./software-world";
let motionPreference: MediaQueryList | undefined;
const ZERO_RENDER_ORIGIN: RenderOriginVec3 = [0, 0, 0];
export const WEBGL_LOCAL_KEY_LIGHT_POSITION = [-8, 14, 7] as const;
const webGLGeometryBoundsCache = new WeakMap<
  THREE.BufferGeometry,
  THREE.Box3 | null
>();
const reduced = () => {
  if (typeof window === "undefined") return false;
  motionPreference ??= window.matchMedia("(prefers-reduced-motion: reduce)");
  return motionPreference.matches;
};
function pointerIdFromEvent(event: Event): number | undefined {
  const pointerId = (event as PointerEvent).pointerId;
  return Number.isInteger(pointerId) && pointerId >= 0 ? pointerId : undefined;
}
function AdaptiveResolution({ onChange }: { onChange: (dpr: number) => void }) {
  const { size } = useThree();
  const budget = useRef<RenderBudget | null>(null);
  useEffect(() => {
    const maximum = maximumRenderDpr(
      size.width,
      size.height,
      window.devicePixelRatio,
    );
    budget.current = new RenderBudget(maximum);
    onChange(maximum);
  }, [size.width, size.height, onChange]);
  useFrame((_, dt) => {
    const next = budget.current?.sample(
      dt,
      document.visibilityState === "visible",
    );
    if (next !== undefined) onChange(next);
  });
  return null;
}
function Planet({
  progress,
  frame,
  spin,
}: {
  progress: React.RefObject<number>;
  frame: ParcelFrame;
  spin: React.RefObject<number>;
}) {
  const group = useRef<THREE.Group>(null);
  const cloud = useRef<THREE.Group>(null);
  const alignment = useMemo(
    () =>
      new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(...frame.normal),
        new THREE.Vector3(0, 0, 1),
      ),
    [frame],
  );
  const spinAxis = useMemo(() => new THREE.Vector3(...frame.normal), [frame]);
  const spinQuaternion = useMemo(() => new THREE.Quaternion(), []);
  const geometry = useMemo(() => {
    const g = new THREE.SphereGeometry(3, 96, 64);
    const p = g.attributes.position;
    const colors = [];
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i) / 3,
        y = p.getY(i) / 3,
        z = p.getZ(i) / 3;
      const n = terrainValue(x, y, z);
      const c = new THREE.Color(
        n > 0.27
          ? n > 0.72
            ? "#719d60"
            : "#a8c786"
          : n > 0.16
            ? "#e5ddaa"
            : n > -0.05
              ? "#65c9bf"
              : "#32a5a5",
      );
      colors.push(c.r, c.g, c.b);
      if (n > 0.27) {
        const r = 1 + Math.max(0, n - 0.3) * 0.018;
        p.setXYZ(i, p.getX(i) * r, p.getY(i) * r, p.getZ(i) * r);
      }
    }
    g.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    g.computeVertexNormals();
    return g;
  }, []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const trees = useMemo(
    () =>
      Array.from({ length: 110 }, (_, i) => {
        const y = 1 - (2 * (i + 0.5)) / 110,
          a = i * 2.39996;
        const v = new THREE.Vector3(
          Math.cos(a) * Math.sqrt(1 - y * y),
          y,
          Math.sin(a) * Math.sqrt(1 - y * y),
        );
        return {
          v,
          q: new THREE.Quaternion().setFromUnitVectors(
            new THREE.Vector3(0, 1, 0),
            v,
          ),
          n: terrainValue(v.x, v.y, v.z),
        };
      }).filter((p) => p.n > 0.5),
    [],
  );
  useFrame((_, dt) => {
    if (group.current) {
      const p = progress.current;
      spinQuaternion.setFromAxisAngle(spinAxis, frame.spinPhase + spin.current);
      group.current.quaternion.copy(alignment).multiply(spinQuaternion);
      group.current.visible = p < 0.98;
      const s = globeScale(p);
      group.current.scale.setScalar(s);
      group.current.position.y = globeOffsetY(p);
    }
    if (cloud.current) cloud.current.rotation.y += dt * 0.012;
  });
  return (
    <group ref={group}>
      <mesh geometry={geometry}>
        <meshStandardMaterial vertexColors roughness={0.87} />
      </mesh>
      <mesh scale={1.035}>
        <sphereGeometry args={[3, 64, 48]} />
        <shaderMaterial
          transparent
          depthWrite={false}
          side={THREE.BackSide}
          uniforms={{}}
          vertexShader={`varying vec3 vN;varying vec3 vV;void main(){vec4 p=modelViewMatrix*vec4(position,1.);vN=normalize(normalMatrix*normal);vV=normalize(-p.xyz);gl_Position=projectionMatrix*p;}`}
          fragmentShader={`varying vec3 vN;varying vec3 vV;void main(){float rim=pow(1.-abs(dot(vN,vV)),3.);gl_FragColor=vec4(.47,.85,.81,rim*.45);}`}
        />
      </mesh>
      {trees.map(({ v, q }, i) => (
        <group key={i} position={v.clone().multiplyScalar(3.02)} quaternion={q}>
          <mesh position={[0, 0.07, 0]}>
            <cylinderGeometry args={[0.022, 0.035, 0.14, 5]} />
            <meshStandardMaterial color="#927c59" />
          </mesh>
          <mesh position={[0, 0.19, 0]}>
            <coneGeometry args={[0.11, 0.28, 6]} />
            <meshStandardMaterial color={i % 2 ? "#52866c" : "#739d58"} />
          </mesh>
        </group>
      ))}
      <group ref={cloud}>
        {Array.from({ length: 9 }, (_, i) => {
          const a = i * 2.4,
            y = Math.sin(i * 1.8) * 0.75,
            v = new THREE.Vector3(
              Math.cos(a) * Math.sqrt(1 - y * y),
              y,
              Math.sin(a) * Math.sqrt(1 - y * y),
            );
          return (
            <group
              key={i}
              position={v.clone().multiplyScalar(3.13)}
              quaternion={new THREE.Quaternion().setFromUnitVectors(
                new THREE.Vector3(0, 1, 0),
                v,
              )}
            >
              {[-1, 0, 1].map((n) => (
                <mesh
                  key={n}
                  position={[n * 0.16, 0.04, 0]}
                  scale={[0.25, 0.055, 0.15]}
                >
                  <sphereGeometry args={[1, 12, 8]} />
                  <meshStandardMaterial
                    color="#f8fff0"
                    transparent
                    opacity={0.8}
                    roughness={1}
                  />
                </mesh>
              ))}
            </group>
          );
        })}
      </group>
    </group>
  );
}

interface FormationAppearance {
  readonly geometry: THREE.BufferGeometry;
  readonly texture?: THREE.DataTexture;
  readonly ownsTexture?: boolean;
  readonly release?: () => void;
}

// Render can be restarted before a layout effect commits. Keep the initial
// props resource-free and allocate per-entity geometry/textures after commit.
const EMPTY_FORMATION_GEOMETRY = (() => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([], 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute([], 3));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
})();
const EMPTY_FORMATION_PARTICLES = (() => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([], 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute([], 3));
  geometry.setAttribute("aFrom", new THREE.Float32BufferAttribute([], 3));
  geometry.setAttribute("aFromColor", new THREE.Float32BufferAttribute([], 3));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
})();

function cloneFormationTexture(texture: THREE.DataTexture): THREE.DataTexture {
  const clone = texture.clone() as THREE.DataTexture;
  clone.needsUpdate = true;
  return clone;
}

function disposeFormationAppearance(
  appearance: FormationAppearance | undefined,
): void {
  if (!appearance) return;
  appearance.geometry.dispose();
  appearance.texture?.dispose();
  appearance.release?.();
}

interface FormationResource {
  readonly appearance: FormationAppearance;
  readonly particleGeometry: THREE.BufferGeometry;
  readonly recipeIdentity: string | undefined;
  disposed: boolean;
}

const EMPTY_FORMATION_RESOURCE: FormationResource = {
  appearance: { geometry: EMPTY_FORMATION_GEOMETRY },
  particleGeometry: EMPTY_FORMATION_PARTICLES,
  recipeIdentity: undefined,
  disposed: false,
};

type FormationReviewSnapshot = {
  ready: boolean;
  pending: boolean;
  failed: boolean;
  renderedRevision: number;
  error?: string;
};

type FormationReviewState = () => FormationReviewSnapshot;

function disposeFormationResource(resource: FormationResource): void {
  if (resource.disposed || resource === EMPTY_FORMATION_RESOURCE) return;
  resource.disposed = true;
  disposeFormationAppearance(resource.appearance);
  resource.particleGeometry.dispose();
}

function Formation({
  entity,
  visible,
  gameplayVisibility,
  completionRecords,
  recipeIdentity,
  displayedGameplayRecipes,
  onFormationComplete,
  session,
  revision,
  onReviewState,
  consumeNavigationClick,
}: {
  entity: Entity;
  visible: boolean;
  gameplayVisibility: GameplayRenderVisibility;
  completionRecords: FormationCompletionRecords;
  recipeIdentity: string;
  displayedGameplayRecipes: DisplayedGameplayRecipeRegistry;
  onFormationComplete: () => void;
  session: GameSession;
  revision: number;
  onReviewState?: (id: string, state: FormationReviewState | undefined) => void;
  consumeNavigationClick: (pointerId?: number) => boolean;
}) {
  const mesh = useRef<THREE.Mesh>(null);
  const particles = useRef<THREE.Points>(null);
  const group = useRef<THREE.Group>(null);
  const previous = useRef<THREE.BufferGeometry>(undefined);
  const previousParticles = useRef<THREE.BufferGeometry>(undefined);
  const previousAppearance = useRef<FormationAppearance>(undefined);
  const displayedTexture = useRef<THREE.DataTexture | undefined>(undefined);
  const progress = useRef({ value: 0 });
  const renderedRevision = useRef(-1);
  const reviewComplete = useRef(false);
  const navigationHitData = useMemo(() => ({ orbsieNavigationHit: true }), []);
  const gameTint = useMemo(() => ({ value: new THREE.Color() }), []);
  const gameTintEnabled = useRef({ value: 0 });
  const gameplayCulled = useRef(false);
  const target = useMemo(() => new THREE.Vector3(), []);
  const targetScale = useMemo(() => new THREE.Vector3(), []);
  const gameplayBoundsScratch = useMemo(() => new THREE.Box3(), []);
  const projectId = useOrb((s) => s.project.id);
  const mainCamera = useThree((state) => state.camera);
  const selected = useOrb((s) => s.selected === entity.id);
  const collected = useOrb((s) => s.score.includes(entity.id));
  const playing = useOrb((s) => s.playing);
  const [bloom, setBloom] = useState(false);
  const assetRecipe =
    entity.geometry?.kind === "asset" || entity.geometry?.kind === "generated"
      ? entity.geometry
      : undefined;
  const catalog = useAssetGeometry(
    assetRecipe?.kind === "asset" && isAssetId(assetRecipe.assetId)
      ? assetRecipe.assetId
      : undefined,
  );
  const generated = useGeneratedGeometry(
    assetRecipe?.kind === "generated" ? assetRecipe.model?.sha256 : undefined,
  );
  const asset = assetRecipe?.kind === "generated" ? generated : catalog;
  const assetTexture =
    assetRecipe?.kind === "asset" ? catalog?.texture : undefined;
  const retainAssetAppearance =
    assetRecipe?.kind === "asset" ? catalog?.retain : undefined;
  const pendingAsset = !!assetRecipe && !asset?.geometry;
  const failedAsset =
    typeof asset?.error === "string" && asset.error.length > 0;
  useEffect(() => {
    if (asset?.error)
      useOrb.getState().set({ error: `${entity.label}: ${asset.error}` });
  }, [asset?.error, entity.label]);
  const [resource, setResource] = useState<FormationResource>(
    () => EMPTY_FORMATION_RESOURCE,
  );
  const resourceMatchesRecipe = formationResourceMatchesRecipe(
    resource.recipeIdentity,
    recipeIdentity,
  );
  const hydrateComplete = formationCanHydrateComplete(
    completionRecords,
    projectId,
    entity.id,
    recipeIdentity,
    resource.recipeIdentity,
    entity.stage,
    pendingAsset,
    failedAsset,
  );
  const activeResource = useRef(resource);
  const mountedResource = useRef(false);
  const allocations = useRef<
    Set<{
      resource: FormationResource;
      cancelled: boolean;
      committed: boolean;
    }>
  >(new Set());
  useLayoutEffect(() => {
    if (assetRecipe && !asset?.geometry) return;
    for (const allocation of allocations.current) {
      if (allocation.committed) continue;
      allocation.cancelled = true;
      allocations.current.delete(allocation);
      disposeFormationResource(allocation.resource);
    }
    let source: THREE.BufferGeometry;
    let sourceTexture: THREE.DataTexture | undefined;
    let ownsTexture = false;
    if (assetRecipe && asset?.geometry) {
      source = asset.geometry.clone();
      if (!assetRecipe.tint && assetTexture) {
        sourceTexture = cloneFormationTexture(assetTexture);
        ownsTexture = true;
      }
    } else {
      source = assetRecipe
        ? entityGeometry({ ...entity, geometry: undefined })
        : entityGeometry(entity);
    }
    if (assetRecipe?.tint && asset?.geometry) {
      const tint = new THREE.Color(assetRecipe.tint);
      const colors = source.getAttribute("color");
      if (colors) {
        for (let i = 0; i < colors.count; i++)
          colors.setXYZ(i, tint.r, tint.g, tint.b);
        colors.needsUpdate = true;
      }
      const sampledColors = source.getAttribute("formationColor");
      if (sampledColors) {
        for (let i = 0; i < sampledColors.count; i++)
          sampledColors.setXYZ(i, tint.r, tint.g, tint.b);
        sampledColors.needsUpdate = true;
      }
    }
    if (
      entity.geometry &&
      entity.geometry.kind !== "asset" &&
      entity.geometry.kind !== "generated"
    ) {
      source.computeBoundingBox();
      const box = source.boundingBox;
      if (box)
        registerContactBounds(entity.geometry, {
          min: box.min.toArray(),
          max: box.max.toArray(),
        });
    }
    const nextAppearance = {
      geometry: source,
      texture: sourceTexture,
      ownsTexture,
    } satisfies FormationAppearance;
    let nextParticles: THREE.BufferGeometry;
    try {
      nextParticles = formationParticles(source);
    } catch (error) {
      disposeFormationAppearance(nextAppearance);
      throw error;
    }
    const nextResource: FormationResource = {
      appearance: nextAppearance,
      particleGeometry: nextParticles,
      recipeIdentity,
      disposed: false,
    };
    const allocation = {
      resource: nextResource,
      cancelled: false,
      committed: false,
    };
    allocations.current.add(allocation);
    setResource((current) => (allocation.cancelled ? current : nextResource));
    return () => {
      allocation.cancelled = true;
      allocations.current.delete(allocation);
      if (!allocation.committed) disposeFormationResource(nextResource);
    };
  }, [
    entity.geometry,
    entity.color,
    recipeIdentity,
    assetRecipe,
    asset?.geometry,
    assetTexture,
  ]);
  const appearance = resource.appearance;
  const particleGeometry = resource.particleGeometry;
  const geometry = appearance.geometry;
  const texture = appearance.texture;
  const commitsAppearance = !assetRecipe || !!asset?.geometry;
  useLayoutEffect(() => {
    activeResource.current = resource;
    if (resource === EMPTY_FORMATION_RESOURCE) return;
    for (const allocation of allocations.current) {
      if (allocation.resource === resource) {
        allocation.committed = true;
        break;
      }
    }
    if (commitsAppearance && resourceMatchesRecipe)
      recordDisplayedGameplayRecipe(
        displayedGameplayRecipes,
        {
          id: entity.id,
          geometry: entity.geometry,
          stage: entity.stage,
        },
        recipeIdentity,
      );
  }, [
    commitsAppearance,
    displayedGameplayRecipes,
    entity.geometry,
    entity.id,
    entity.stage,
    recipeIdentity,
    resource,
    resourceMatchesRecipe,
  ]);
  useLayoutEffect(() => {
    if (
      !commitsAppearance ||
      !resourceMatchesRecipe ||
      geometry === EMPTY_FORMATION_GEOMETRY
    )
      return;
    const retained: FormationAppearance = {
      geometry: geometry.clone(),
      texture: texture ? cloneFormationTexture(texture) : undefined,
      release: texture ? retainAssetAppearance?.() : undefined,
    };
    const prior = previousAppearance.current;
    previousAppearance.current = retained;
    disposeFormationAppearance(prior);
  }, [
    commitsAppearance,
    geometry,
    resourceMatchesRecipe,
    texture,
    retainAssetAppearance,
  ]);
  useLayoutEffect(() => {
    if (
      resource === EMPTY_FORMATION_RESOURCE ||
      !commitsAppearance ||
      !resourceMatchesRecipe
    )
      return;
    renderedRevision.current = revision;
    notifySceneReviewCaptureChanged();
  }, [commitsAppearance, resource, resourceMatchesRecipe, revision]);
  useLayoutEffect(() => {
    const state: FormationReviewState = () => {
      const failed = typeof asset?.error === "string" && asset.error.length > 0;
      const pending =
        !failed &&
        (resource === EMPTY_FORMATION_RESOURCE ||
          !commitsAppearance ||
          !resourceMatchesRecipe ||
          renderedRevision.current !== revision ||
          progress.current.value < 1);
      return {
        ready: !failed && !pending,
        pending,
        failed,
        renderedRevision: renderedRevision.current,
        error: failed ? asset.error : undefined,
      };
    };
    onReviewState?.(entity.id, state);
    notifySceneReviewCaptureChanged();
    return () => {
      onReviewState?.(entity.id, undefined);
      notifySceneReviewCaptureChanged();
    };
  }, [
    asset?.error,
    commitsAppearance,
    entity.id,
    entity.geometry,
    onReviewState,
    resource,
    resourceMatchesRecipe,
    recipeIdentity,
    revision,
  ]);
  useLayoutEffect(() => {
    if (
      geometry === EMPTY_FORMATION_GEOMETRY &&
      particleGeometry === EMPTY_FORMATION_PARTICLES
    )
      return;
    const particleSnapshot = previousParticles.current
      ? captureFormationSnapshot(
          previousParticles.current,
          progress.current.value,
        )
      : undefined;
    addFormationSource(particleGeometry, particleSnapshot);
    previousParticles.current = particleGeometry;
    const prior = previous.current;
    const sameIndex =
      prior &&
      ((!prior.index && !geometry.index) ||
        (prior.index &&
          geometry.index &&
          prior.index.count === geometry.index.count &&
          Array.from(prior.index.array).every(
            (value, index) => value === geometry.index!.array[index],
          )));
    geometry.userData.particleBridge = hydrateComplete
      ? false
      : !prior ||
        (prior.userData.particleBridge && progress.current.value < 1) ||
        displayedTexture.current !== texture ||
        !sameIndex ||
        prior.getAttribute("position").count !==
          geometry.getAttribute("position").count;
    particleGeometry.userData.particleBridge = geometry.userData.particleBridge;
    const visible = previous.current
      ? captureFormationSnapshot(previous.current, progress.current.value)
      : undefined;
    addFormationSource(geometry, visible);
    previous.current = geometry;
    displayedTexture.current = texture;
    progress.current.value = hydrateComplete ? 1 : 0;
    if (mesh.current) mesh.current.visible = !geometry.userData.particleBridge;
    if (particles.current)
      particles.current.visible = geometry.userData.particleBridge;
  }, [geometry, hydrateComplete, particleGeometry]);
  useEffect(() => {
    mountedResource.current = true;
    return () => {
      mountedResource.current = false;
      // React development StrictMode immediately replays passive effects. A
      // microtask lets the replacement setup cancel that replay cleanup while
      // still disposing on a real replacement or unmount.
      queueMicrotask(() => {
        if (!mountedResource.current || activeResource.current !== resource)
          disposeFormationResource(resource);
      });
    };
  }, [resource]);
  useEffect(
    () => () => {
      disposeFormationAppearance(previousAppearance.current);
      previousAppearance.current = undefined;
      displayedTexture.current = undefined;
    },
    [],
  );
  const material = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.76,
      metalness: 0.02,
    });
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uFormation = progress.current;
      shader.uniforms.uGameTint = gameTint;
      shader.uniforms.uGameTintEnabled = gameTintEnabled.current;
      shader.fragmentShader =
        "uniform vec3 uGameTint; uniform float uGameTintEnabled;\n" +
        shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <color_fragment>",
        "#include <color_fragment>\nif(uGameTintEnabled > 0.5) diffuseColor.rgb = uGameTint;",
      );
      shader.vertexShader =
        "attribute vec3 aFrom; attribute vec3 aFromColor; uniform float uFormation;\n" +
        shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        "#include <color_vertex>",
        "#include <color_vertex>\n#if defined(USE_COLOR) || defined(USE_COLOR_ALPHA)\nvColor.rgb = mix(aFromColor, color.rgb, smoothstep(0.0,1.0,uFormation));\n#endif",
      );
      shader.vertexShader = shader.vertexShader.replace(
        "#include <begin_vertex>",
        "vec3 transformed=mix(aFrom,position,smoothstep(0.0,1.0,uFormation));",
      );
    };
    m.customProgramCacheKey = () => "orbsie-formation-v3";
    return m;
  }, []);
  useLayoutEffect(() => {
    const nextTexture = texture ?? null;
    if (material.map === nextTexture) return;
    material.map = nextTexture;
    material.needsUpdate = true;
  }, [material, texture]);
  const particleMaterial = useMemo(() => {
    const points = new THREE.PointsMaterial({
      vertexColors: true,
      size: 0.12,
      sizeAttenuation: true,
    });
    points.onBeforeCompile = (shader, renderer) => {
      material.onBeforeCompile(shader, renderer);
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <clipping_planes_fragment>",
        "#include <clipping_planes_fragment>\nif (distance(gl_PointCoord, vec2(0.5)) > 0.5) discard;",
      );
    };
    points.customProgramCacheKey = () => "orbsie-formation-particles-v1";
    return points;
  }, [material]);
  useEffect(() => () => particleMaterial.dispose(), [particleMaterial]);
  useEffect(() => () => material.dispose(), [material]);
  useFrame(({ clock }, dt) => {
    progress.current.value = Math.min(
      1,
      progress.current.value + dt / (reduced() ? 0.02 : 0.9),
    );
    const complete = progress.current.value >= 1;
    if (
      complete &&
      commitsAppearance &&
      resource !== EMPTY_FORMATION_RESOURCE &&
      resourceMatchesRecipe &&
      geometry !== EMPTY_FORMATION_GEOMETRY
    ) {
      const wasCompleted =
        completionRecords.get(projectId)?.get(entity.id) === recipeIdentity;
      const marked = markFormationComplete(
        completionRecords,
        projectId,
        entity.id,
        recipeIdentity,
        resource.recipeIdentity,
        entity.stage,
        pendingAsset,
        failedAsset,
        progress.current.value,
      );
      if (marked && !wasCompleted) onFormationComplete();
    }
    if (complete !== reviewComplete.current) {
      reviewComplete.current = complete;
      notifySceneReviewCaptureChanged();
    }
    // Point correspondence has no triangle connectivity to tear between topologies.
    // Solidify only when every interpolated point has reached its target.
    if (mesh.current)
      mesh.current.visible =
        !geometry.userData.particleBridge || progress.current.value >= 1;
    if (particles.current)
      particles.current.visible =
        !!geometry.userData.particleBridge && progress.current.value < 1;
    if (!group.current) return;
    const effective = playing ? session.effectiveEntity(entity) : entity;
    group.current.visible = effective !== null && visible;
    gameplayCulled.current = false;
    const visibilityProbe = (
      globalThis as typeof globalThis & {
        __orbsieFormationVisibilityProbe?: Record<string, boolean>;
      }
    ).__orbsieFormationVisibilityProbe;
    if (!effective) {
      if (visibilityProbe)
        visibilityProbe[entity.id] =
          group.current.visible &&
          (mesh.current?.visible === true ||
            particles.current?.visible === true);
      return;
    }
    const override = playing
      ? session.state?.entityOverrides[entity.id]
      : undefined;
    gameTintEnabled.current.value = override?.color ? 1 : 0;
    if (override?.color) gameTint.value.set(override.color);
    const snapshot = useOrb.getState().project;
    const hierarchical = usesSceneHierarchy(snapshot);
    group.current.matrixAutoUpdate = !hierarchical;
    if (hierarchical) {
      const pose = runtimeEntityMatrix(
        resolveRuntimeScene(snapshot),
        entity,
        clock.elapsedTime,
        override?.position,
      );
      if (!playing && entity.geometry?.kind === "crystal")
        pose.elements[13] +=
          Math.sin(clock.elapsedTime * 2 + entity.position[0]) * 0.13;
      if (bloom) pose.scale(new THREE.Vector3(1.35, 1.35, 1.35));
      group.current.matrix.copy(pose);
      group.current.matrixWorldNeedsUpdate = true;
    } else {
      target.set(...movingEntityPosition(effective, clock.elapsedTime));
      if (!playing && entity.geometry?.kind === "crystal")
        target.y += Math.sin(clock.elapsedTime * 2 + entity.position[0]) * 0.13;
      if (
        playing ||
        (entity.behavior?.type === "move" && entity.stage === "ready")
      )
        group.current.position.copy(target);
      else group.current.position.lerp(target, 1 - Math.exp(-dt * 12));
      targetScale.set(...entity.scale).multiplyScalar(bloom ? 1.35 : 1);
      if (playing) group.current.scale.copy(targetScale);
      else group.current.scale.lerp(targetScale, 1 - Math.exp(-dt * 5));
    }
    if (mesh.current && entity.geometry?.kind === "crystal")
      mesh.current.rotation.y += dt * 0.6;
    if (particles.current && mesh.current)
      particles.current.rotation.copy(mesh.current.rotation);
    if (
      playing &&
      group.current.visible &&
      gameplayVisibility.ready &&
      !selected &&
      !pendingAsset &&
      entity.stage === "ready" &&
      entity.behavior?.type !== "portal" &&
      progress.current.value >= 1 &&
      resource !== EMPTY_FORMATION_RESOURCE &&
      geometry !== EMPTY_FORMATION_GEOMETRY &&
      mesh.current
    ) {
      group.current.updateWorldMatrix(true, false);
      mesh.current.updateWorldMatrix(true, false);
      if (
        !webGLGeometryVisibleInFrustum(
          geometry,
          mesh.current.matrixWorld,
          gameplayVisibility.frustum,
          gameplayBoundsScratch,
        )
      ) {
        gameplayCulled.current = true;
        group.current.visible = false;
      }
    }
    material.emissive.set(
      entity.stage !== "ready" || pendingAsset
        ? "#9debd4"
        : selected
          ? "#497d6c"
          : "#000000",
    );
    material.emissiveIntensity =
      entity.stage !== "ready" || pendingAsset
        ? 0.3 + Math.sin(clock.elapsedTime * 3) * 0.15
        : selected
          ? 0.18
          : 0;
    if (visibilityProbe)
      visibilityProbe[entity.id] =
        group.current.visible &&
        (mesh.current?.visible === true || particles.current?.visible === true);
  });
  const click = (event: ThreeEvent<MouseEvent>) => {
    if (gameplayCulled.current) return;
    if (
      consumeNavigationClick(pointerIdFromEvent(event.nativeEvent as Event))
    ) {
      event.stopPropagation();
      return;
    }
    if (playing && !session.effectiveEntity(entity)) return;
    event.stopPropagation();
    if (playing && session.state) {
      session.queueClick(entity.id);
      return;
    }
    if (playing && entity.behavior?.type === "bloom") {
      setBloom(!bloom);
      return;
    }
    if (!playing) useOrb.getState().set({ selected: entity.id });
  };
  if (collected && entity.behavior?.type === "collect") return null;
  return (
    <group
      ref={group}
      userData={navigationHitData}
      position={entity.position}
      scale={entity.scale}
    >
      <points
        ref={particles}
        onAfterRender={(_renderer, _scene, renderCamera) => {
          if (renderCamera === mainCamera && (!assetRecipe || asset?.geometry))
            markSceneUpdateDraw(projectId, entity);
          if (renderCamera === mainCamera && progress.current.value < 0.15)
            markVisibleSeed(projectId, entity.id);
        }}
        geometry={particleGeometry}
        material={particleMaterial}
        frustumCulled={false}
        raycast={(raycaster, intersections) => {
          if (gameplayCulled.current || !particles.current) return;
          THREE.Points.prototype.raycast.call(
            particles.current,
            raycaster,
            intersections,
          );
        }}
        onClick={click}
      />
      <mesh
        ref={mesh}
        onAfterRender={(_renderer, _scene, renderCamera) => {
          if (renderCamera === mainCamera && (!assetRecipe || asset?.geometry))
            markSceneUpdateDraw(projectId, entity);
        }}
        geometry={geometry}
        material={material}
        onClick={click}
        raycast={(raycaster, intersections) => {
          if (
            !gameplayCulled.current &&
            mesh.current &&
            (!playing || session.effectiveEntity(entity))
          )
            THREE.Mesh.prototype.raycast.call(
              mesh.current,
              raycaster,
              intersections,
            );
        }}
        castShadow
        receiveShadow
        onPointerOver={() => {
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          document.body.style.cursor = "auto";
        }}
      />
      {selected && !playing && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
          <ringGeometry args={[0.72, 0.78, 48]} />
          <meshBasicMaterial color="#fff8cc" side={THREE.DoubleSide} />
        </mesh>
      )}
      {entity.behavior?.type === "portal" && (
        <mesh position={[0, 1.2, 0]}>
          <circleGeometry args={[0.63, 40]} />
          <meshBasicMaterial
            color="#bdedcf"
            transparent
            opacity={0.48}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}
    </group>
  );
}

function FormationProxy({
  entity,
  recipeIdentity,
  visualBounds,
  resolvedScene,
  hierarchical,
  projectId,
  revision,
  visible,
  session,
  onReviewState,
  consumeNavigationClick,
}: {
  entity: Entity;
  recipeIdentity: string;
  visualBounds: FormationProxyVisualBounds;
  resolvedScene: ResolvedScene;
  hierarchical: boolean;
  projectId: string;
  revision: number;
  visible: boolean;
  session: GameSession;
  onReviewState?: (id: string, state: FormationReviewState | undefined) => void;
  consumeNavigationClick: (pointerId?: number) => boolean;
}) {
  const group = useRef<THREE.Group>(null);
  const material = useRef<THREE.MeshStandardMaterial>(null);
  const mainCamera = useThree((state) => state.camera);
  const playing = useOrb((state) => state.playing);
  const collected = useOrb((state) => state.score.includes(entity.id));
  const [bloom, setBloom] = useState(false);
  const drawnRevision = useRef<number | undefined>(undefined);
  const visibleRef = useRef(visible);
  const navigationHitData = useMemo(() => ({ orbsieNavigationHit: true }), []);
  const fallbackColor =
    entity.geometry?.kind === "asset"
      ? (entity.geometry.tint ?? entity.color)
      : entity.color;
  const baseNode = resolvedScene.entities.get(entity.id);

  useLayoutEffect(() => {
    if (!baseNode || entity.stage !== "ready") return;
    const state: FormationReviewState = () =>
      formationProxyReviewSnapshot(
        revision,
        drawnRevision.current,
        visibleRef.current &&
          !(collected && entity.behavior?.type === "collect") &&
          (!playing || session.effectiveEntity(entity) !== null),
      );
    onReviewState?.(entity.id, state);
    notifySceneReviewCaptureChanged();
    return () => {
      onReviewState?.(entity.id, undefined);
      notifySceneReviewCaptureChanged();
    };
  }, [
    baseNode,
    collected,
    entity,
    entity.id,
    entity.stage,
    onReviewState,
    playing,
    recipeIdentity,
    revision,
    session,
  ]);

  useLayoutEffect(() => {
    visibleRef.current = visible;
    notifySceneReviewCaptureChanged();
  }, [visible]);

  useFrame(({ clock }) => {
    if (!group.current) return;
    const effective = playing ? session.effectiveEntity(entity) : entity;
    if (!effective) {
      group.current.visible = false;
      return;
    }
    group.current.visible = true;
    group.current.scale.set(
      visualBounds.size[0] * (bloom ? 1.35 : 1),
      visualBounds.size[1] * (bloom ? 1.35 : 1),
      visualBounds.size[2] * (bloom ? 1.35 : 1),
    );

    const override = playing
      ? session.state?.entityOverrides[entity.id]
      : undefined;
    const positionOverride = override?.position;
    const moving = entity.stage === "ready" && entity.behavior?.type === "move";
    const hoveringCrystal = !playing && entity.geometry?.kind === "crystal";
    if (positionOverride || moving || hoveringCrystal) {
      let delta: WorldNavigationVec3 = [0, 0, 0];
      if (hierarchical) {
        try {
          const matrix = runtimeEntityMatrix(
            resolvedScene,
            entity,
            clock.elapsedTime,
            positionOverride,
          );
          if (baseNode) {
            delta = [
              matrix.elements[12] - baseNode.worldPosition[0],
              matrix.elements[13] - baseNode.worldPosition[1],
              matrix.elements[14] - baseNode.worldPosition[2],
            ];
          }
        } catch {
          // Keep a conservative proxy at the last resolved world center.
        }
      } else {
        const position = [
          ...movingEntityPosition(effective, clock.elapsedTime),
        ] as [number, number, number];
        if (hoveringCrystal)
          position[1] +=
            Math.sin(clock.elapsedTime * 2 + entity.position[0]) * 0.13;
        delta = [
          position[0] - entity.position[0],
          position[1] - entity.position[1],
          position[2] - entity.position[2],
        ];
      }
      group.current.position.set(
        visualBounds.center[0] + delta[0],
        visualBounds.center[1] + delta[1],
        visualBounds.center[2] + delta[2],
      );
    }
    if (material.current)
      material.current.color.set(override?.color ?? fallbackColor);
  });

  if (collected && entity.behavior?.type === "collect") return null;

  const click = (event: ThreeEvent<MouseEvent>) => {
    if (
      consumeNavigationClick(pointerIdFromEvent(event.nativeEvent as Event))
    ) {
      event.stopPropagation();
      return;
    }
    if (playing && !session.effectiveEntity(entity)) return;
    event.stopPropagation();
    if (playing && session.state) {
      session.queueClick(entity.id);
      return;
    }
    if (playing && entity.behavior?.type === "bloom") {
      setBloom(!bloom);
      return;
    }
    if (!playing) useOrb.getState().set({ selected: entity.id });
  };

  if (!baseNode) return null;
  return (
    <group
      ref={group}
      userData={navigationHitData}
      position={visualBounds.center}
      scale={visualBounds.size}
    >
      <mesh
        onAfterRender={(_renderer, _scene, renderCamera) => {
          if (renderCamera !== mainCamera || entity.stage !== "ready") return;
          const wasReady = formationProxyReviewSnapshot(
            revision,
            drawnRevision.current,
            visibleRef.current,
          ).ready;
          drawnRevision.current = revision;
          markSceneUpdateDraw(projectId, entity);
          if (
            !wasReady &&
            formationProxyReviewSnapshot(
              revision,
              drawnRevision.current,
              visibleRef.current,
            ).ready
          )
            notifySceneReviewCaptureChanged();
        }}
        onClick={click}
        onPointerOver={() => {
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          document.body.style.cursor = "auto";
        }}
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial
          ref={material}
          color={fallbackColor}
          roughness={0.82}
        />
      </mesh>
    </group>
  );
}

function Player({
  session,
  followPositionRef,
  displayedGameplayRecipes,
  recipeByEntity,
  onReady,
  onInputLatency,
}: {
  session: GameSession;
  followPositionRef: { current: WorldNavigationVec3 };
  displayedGameplayRecipes: DisplayedGameplayRecipeRegistry;
  recipeByEntity: ReadonlyMap<string, string>;
  onReady?: () => void;
  onInputLatency?: (snapshot: PlayerInputLatencySnapshot) => void;
}) {
  const inputsReady = useRef(false);
  const announcedReady = useRef(false);
  const generation = useRef(-1);
  const ref = useRef<THREE.Group>(null);
  const [initialPlayerState] = useState<PlayerState>(() => ({
    position: playerSpawnForProject(useOrb.getState().project),
    velocityY: 0,
  }));
  const state = useRef<PlayerState>(initialPlayerState);
  const inputs = useRef(
    new PlayerInputTracker(
      onInputLatency ? { latencyTelemetry: true } : undefined,
    ),
  );
  const onInputLatencyRef = useRef(onInputLatency);
  onInputLatencyRef.current = onInputLatency;
  const direction = useMemo(() => new THREE.Vector3(), []);
  const up = useMemo(() => new THREE.Vector3(0, 1, 0), []);
  const playing = useOrb((s) => s.playing);
  const reset = useOrb((s) => s.reset);
  const projectId = useOrb((s) => s.project.id);
  const hasEnteredPlay = useRef(playing);
  const enteredPlayProjectId = useRef(projectId);
  useEffect(() => {
    if (!playing) {
      inputs.current.clear();
      return;
    }
    if (hasEnteredPlay.current) return;
    hasEnteredPlay.current = true;
    state.current = {
      position: playerSpawnForProject(useOrb.getState().project),
      velocityY: 0,
    };
    followPositionRef.current = state.current.position;
    inputs.current.clear();
  }, [followPositionRef, playing]);
  useEffect(() => {
    if (enteredPlayProjectId.current !== projectId) {
      enteredPlayProjectId.current = projectId;
      hasEnteredPlay.current = false;
    }
    state.current = {
      position: playerSpawnForProject(useOrb.getState().project),
      velocityY: 0,
    };
    followPositionRef.current = state.current.position;
    inputs.current.clear();
  }, [followPositionRef, reset, projectId]);
  useEffect(() => {
    const legacyPointerIds = new Map<string, number | string>();
    const changeKey = (key: string, down: boolean) => {
      if (actionForPlayerKey(key)) inputs.current.setKeyboard(key, down);
    };
    const key = (e: KeyboardEvent, down: boolean) => {
      const textEntry = isTextEntryTarget(e.target);
      const buttonActivation =
        (e.target as Element)?.closest("button") &&
        [" ", "Enter"].includes(e.key);
      // Always process releases so focus changes cannot leave a key held.
      if (down && (textEntry || buttonActivation)) return;
      if (
        down &&
        ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(e.key)
      )
        e.preventDefault();
      changeKey(e.key.toLowerCase(), down);
    };
    const d = (e: KeyboardEvent) => key(e, true),
      u = (e: KeyboardEvent) => key(e, false);
    const blur = () => {
      inputs.current.clear();
      legacyPointerIds.clear();
    };
    const focus = (event: FocusEvent) => {
      if (isTextEntryTarget(event.target)) blur();
    };
    const touch = (e: Event) => {
      const detail = (e as CustomEvent<PlayerInputDetail>).detail;
      if (
        typeof detail?.key === "string" &&
        (detail.pointerId === undefined || Number.isInteger(detail.pointerId))
      ) {
        const key = detail.key.toLowerCase();
        const pointerId =
          detail.pointerId ?? legacyPointerIds.get(key) ?? `legacy:${key}`;
        if (detail.pointerId === undefined && detail.down)
          legacyPointerIds.set(key, pointerId);
        inputs.current.setPointer(pointerId, detail.key, Boolean(detail.down));
        if (detail.pointerId === undefined && !detail.down)
          legacyPointerIds.delete(key);
      }
    };
    const hidden = () => {
      if (document.visibilityState === "hidden") blur();
    };
    window.addEventListener("keydown", d);
    window.addEventListener("keyup", u);
    window.addEventListener("blur", blur);
    window.addEventListener("pagehide", blur);
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("focusin", focus);
    window.addEventListener("orbsie-input", touch);
    inputsReady.current = true;
    return () => {
      inputsReady.current = false;
      blur();
      window.removeEventListener("keydown", d);
      window.removeEventListener("keyup", u);
      window.removeEventListener("blur", blur);
      window.removeEventListener("pagehide", blur);
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("focusin", focus);
      window.removeEventListener("orbsie-input", touch);
    };
  }, []);
  useFrame(({ clock }, delta) => {
    if (!ref.current) return;
    ref.current.visible = playing;
    const s = useOrb.getState();
    const restartReason = session.sync(s.project.id, s.project.game, s.reset);
    if (playing && restartReason === "rules-changed")
      s.set({
        notice: GAME_RULES_RESTART_NOTICE,
        ruleRestartCount: s.ruleRestartCount + 1,
      });
    const resetAvatar = () => {
      if (generation.current === session.resetGeneration) return false;
      generation.current = session.resetGeneration;
      state.current = {
        position: playerSpawnForProject(s.project),
        velocityY: 0,
      };
      followPositionRef.current = state.current.position;
      s.set({ score: [], gameScore: 0, won: false, lost: false });
      return true;
    };
    resetAvatar();
    followPositionRef.current = state.current.position;
    if (!playing) {
      inputs.current.clear();
      return;
    }
    const dt = Math.min(delta, 0.04),
      input = inputs.current;
    direction.set(
      (input.isHeld("right") ? 1 : 0) - (input.isHeld("left") ? 1 : 0),
      0,
      (input.isHeld("down") ? 1 : 0) - (input.isHeld("up") ? 1 : 0),
    );
    const pressed = input.consumePressed();
    if (pressed.length > 0)
      onInputLatencyRef.current?.(input.getLatencySnapshot());
    for (const action of pressed) session.queueInput(action);
    session.advance(dt);
    const didReset = resetAvatar();
    direction.applyAxisAngle(up, 0.5);
    if (direction.length()) direction.normalize();
    const hierarchyScene = usesSceneHierarchy(s.project)
      ? resolveRuntimeScene(s.project)
      : undefined;
    const worldMatrices = hierarchyScene
      ? new Map(
          s.project.entities.map((entity) => [
            entity.id,
            runtimeEntityMatrix(
              hierarchyScene,
              entity,
              clock.elapsedTime,
              session.state?.entityOverrides[entity.id]?.position,
            ),
          ]),
        )
      : undefined;
    const result = stepGameplay(
      state.current,
      {
        x: direction.x,
        z: direction.z,
        jump: input.isHeld("jump") || pressed.includes("jump"),
      },
      s.project.entities
        .map((entity) =>
          gameplayEntityFromDisplayedRecipe(
            entity,
            displayedGameplayRecipes,
            recipeByEntity.get(entity.id) ?? "",
          ),
        )
        .map((entity) => session.effectiveEntity(entity))
        .filter((entity): entity is Entity => entity !== null),
      didReset ? [] : useOrb.getState().score,
      clock.elapsedTime,
      session.state && session.state.status !== "playing" ? 0 : dt,
      session.collisionTargets,
      worldMatrices,
    );
    state.current = result;
    followPositionRef.current = result.position;
    const beforeContacts = session.resetGeneration;
    session.emitContacts(result.contacts);
    if (session.resetGeneration === beforeContacts)
      session.emitCollections(result.collected);
    const resetAfterEvents = resetAvatar();
    if (
      !resetAfterEvents &&
      result.collected.length !== useOrb.getState().score.length
    )
      s.set({ score: result.collected });
    if (session.state) {
      const current = useOrb.getState();
      const won = session.state.status === "won",
        lost = session.state.status === "lost";
      if (
        current.gameScore !== session.state.score ||
        current.won !== won ||
        current.lost !== lost
      )
        s.set({ gameScore: session.state.score, won, lost });
      if (session.error && current.error !== session.error.message)
        s.set({ error: session.error.message });
    } else if (result.won && !s.won) s.set({ won: true });
    if (gameplayObservationRequested()) {
      const observedEntities = s.project.entities.flatMap((entity) => {
        const effective = session.effectiveEntity(entity);
        if (!effective) return [];
        const matrix = worldMatrices?.get(entity.id);
        const position = matrix
          ? ([
              matrix.elements[12],
              matrix.elements[13],
              matrix.elements[14],
            ] as [number, number, number])
          : movingEntityPosition(effective, clock.elapsedTime);
        return [
          {
            id: entity.id,
            behavior: entity.behavior?.type ?? null,
            stage: effective.stage,
            position,
            scale: [...effective.scale] as [number, number, number],
          },
        ];
      });
      const latest = useOrb.getState();
      publishGameplayObservation({
        renderer: "webgl",
        projectId: latest.project.id,
        revision: latest.project.revision,
        simulationDeltaMs: dt * 1000,
        playing: latest.playing,
        player: state.current,
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
    if (inputsReady.current) {
      markExperience(s.project.id, "controls");
      if (
        hasExperienceMilestone(s.project.id, "submission") &&
        !hasExperienceMilestone(s.project.id, "objective")
      ) {
        const objectiveIds = s.project.game
          ? collectGameProgramEntityIds(s.project.game)
          : s.project.entities
              .filter(
                (entity) =>
                  entity.behavior?.type === "portal" ||
                  entity.behavior?.type === "collect",
              )
              .map((entity) => entity.id);
        const hasObjective = s.project.game
          ? s.project.game.rules.some((rule) =>
              rule.actions.some(
                (action) => action.type === "win" || action.type === "lose",
              ),
            )
          : s.project.entities.some(
              (entity) => entity.behavior?.type === "portal",
            );
        if (
          hasObjective &&
          !session.error &&
          objectiveIds.every((id) => {
            const entity = s.project.entities.find(
              (candidate) => candidate.id === id,
            );
            return displayedGameplayRecipeMatchesCurrent(
              displayedGameplayRecipes.get(id),
              entity ? formationRecipeIdentity(entity) : undefined,
              entity?.stage,
            );
          })
        )
          markExperience(s.project.id, "objective");
      }
    }
    if (inputsReady.current && !announcedReady.current) {
      announcedReady.current = true;
      onReady?.();
    }
    ref.current.position.set(...state.current.position);
    if (direction.length())
      ref.current.rotation.y = Math.atan2(direction.x, direction.z);
    ref.current.position.y += direction.length()
      ? Math.abs(Math.sin(clock.elapsedTime * 10)) * 0.045
      : 0;
  }, -1);
  return (
    <group ref={ref}>
      <mesh castShadow>
        <capsuleGeometry args={[0.22, 0.36, 5, 10]} />
        <meshStandardMaterial color="#fff8db" roughness={0.7} />
      </mesh>
      <mesh position={[0, 0.12, 0.2]}>
        <sphereGeometry args={[0.14, 12, 8]} />
        <meshStandardMaterial color="#3a665c" />
      </mesh>
      <mesh position={[0, 0.5, 0]}>
        <sphereGeometry args={[0.08, 8, 8]} />
        <meshStandardMaterial
          color="#f1c071"
          emissive="#f1c071"
          emissiveIntensity={0.4}
        />
      </mesh>
    </group>
  );
}
function Pebbles() {
  const mesh = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    if (!mesh.current) return;
    const transform = new THREE.Object3D();
    const color = new THREE.Color();
    for (let i = 0; i < 45; i++) {
      const radius = 7.2 + (i % 3) * 0.3;
      const scale = 0.1 + (i % 4) * 0.08;
      transform.position.set(
        Math.cos(i * 2.4) * radius,
        0.02,
        Math.sin(i * 2.4) * radius,
      );
      transform.scale.set(scale, scale * 0.5, scale);
      transform.updateMatrix();
      mesh.current.setMatrixAt(i, transform.matrix);
      mesh.current.setColorAt(i, color.set(i % 3 ? "#d8d7b0" : "#cad7a6"));
    }
    mesh.current.instanceMatrix.needsUpdate = true;
    if (mesh.current.instanceColor)
      mesh.current.instanceColor.needsUpdate = true;
    mesh.current.computeBoundingSphere();
  }, []);
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, 45]}>
      <sphereGeometry args={[1, 6, 4]} />
      <meshStandardMaterial />
    </instancedMesh>
  );
}

const WORLD_TERRAIN_GRID_SEGMENTS = 16;

function createWorldTerrainChunkGeometry(
  chunk: WorldTerrainChunkKey,
): THREE.BufferGeometry {
  const size = worldTerrainChunkSize(chunk.lod);
  const stride = WORLD_TERRAIN_GRID_SEGMENTS + 1;
  const vertexCount = stride * stride;
  const positions = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);
  const indices: number[] = [];
  for (let row = 0; row <= WORLD_TERRAIN_GRID_SEGMENTS; row++) {
    for (let column = 0; column <= WORLD_TERRAIN_GRID_SEGMENTS; column++) {
      const u = column / WORLD_TERRAIN_GRID_SEGMENTS;
      const v = row / WORLD_TERRAIN_GRID_SEGMENTS;
      const sample = sampleWorldTerrainChunk(chunk, u, v);
      const vertex = row * stride + column;
      const offset = vertex * 3;
      positions[offset] = u * size;
      positions[offset + 1] = 0;
      positions[offset + 2] = v * size;
      const tone = 0.89 + sample.appearance * 0.22;
      colors[offset] = tone;
      colors[offset + 1] = tone;
      colors[offset + 2] = tone;

      if (
        column === WORLD_TERRAIN_GRID_SEGMENTS ||
        row === WORLD_TERRAIN_GRID_SEGMENTS
      )
        continue;
      const lowerLeft = vertex;
      const lowerRight = vertex + 1;
      const upperLeft = vertex + stride;
      const upperRight = upperLeft + 1;
      // X/Z coordinates are wound to face up toward world +Y.
      indices.push(
        lowerLeft,
        upperLeft,
        lowerRight,
        lowerRight,
        upperLeft,
        upperRight,
      );
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function WorldTerrainChunk({
  chunk,
  color,
}: {
  chunk: WorldTerrainChunkKey;
  color: string;
}) {
  const size = worldTerrainChunkSize(chunk.lod);
  // Stable keyed chunks keep overlapping geometry. Geometry passed as a mesh
  // prop is not an R3F child, so dispose it when an evicted key unmounts.
  const geometry = useMemo(
    () => createWorldTerrainChunkGeometry(chunk),
    [chunk.lod, chunk.x, chunk.z],
  );
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh
      geometry={geometry}
      position={[chunk.x * size, 0, chunk.z * size]}
      receiveShadow
    >
      <meshStandardMaterial color={color} vertexColors roughness={1} />
    </mesh>
  );
}

function applyWebGLRenderOrigin(
  workspaceFrame: THREE.Group | null,
  origin: RenderOriginVec3,
) {
  workspaceFrame?.position.set(-origin[0], -origin[1], -origin[2]);
}

type GameplayRenderVisibility = {
  frustum: THREE.Frustum;
  projectionView: THREE.Matrix4;
  ready: boolean;
};

function finiteBox(box: THREE.Box3): boolean {
  return (
    Number.isFinite(box.min.x) &&
    Number.isFinite(box.min.y) &&
    Number.isFinite(box.min.z) &&
    Number.isFinite(box.max.x) &&
    Number.isFinite(box.max.y) &&
    Number.isFinite(box.max.z) &&
    box.min.x <= box.max.x &&
    box.min.y <= box.max.y &&
    box.min.z <= box.max.z
  );
}

/** Only a finite transformed geometry bound may suppress gameplay drawing. */
export function webGLGeometryVisibleInFrustum(
  geometry: THREE.BufferGeometry,
  worldMatrix: THREE.Matrix4,
  frustum: THREE.Frustum,
  transformedBounds = new THREE.Box3(),
): boolean {
  let localBounds: THREE.Box3 | null | undefined;
  if (webGLGeometryBoundsCache.has(geometry)) {
    localBounds = webGLGeometryBoundsCache.get(geometry);
  } else {
    localBounds = null;
    try {
      geometry.computeBoundingBox();
      if (geometry.boundingBox && finiteBox(geometry.boundingBox))
        localBounds = geometry.boundingBox.clone();
    } catch {
      // Keep unclassifiable geometry visible.
    }
    webGLGeometryBoundsCache.set(geometry, localBounds);
  }
  if (!localBounds || !worldMatrix.elements.every(Number.isFinite)) return true;
  try {
    transformedBounds.copy(localBounds).applyMatrix4(worldMatrix);
    if (!finiteBox(transformedBounds)) return true;
    return frustum.intersectsBox(transformedBounds);
  } catch {
    return true;
  }
}

function updateGameplayRenderVisibility(
  state: GameplayRenderVisibility,
  camera: THREE.Camera,
): boolean {
  try {
    camera.updateMatrixWorld(true);
    state.projectionView.multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    );
    if (!state.projectionView.elements.every(Number.isFinite)) return false;
    state.frustum.setFromProjectionMatrix(state.projectionView);
    return state.frustum.planes.every(
      (plane) =>
        Number.isFinite(plane.constant) &&
        Number.isFinite(plane.normal.x) &&
        Number.isFinite(plane.normal.y) &&
        Number.isFinite(plane.normal.z),
    );
  } catch {
    return false;
  }
}

/** Use the same settled navigation pose and projection as the WebGL camera. */
export function visibleWebGLNavigationEntityIds(
  project: Project,
  boundsByEntity: WorldNavigationEntityBounds,
  navigation: WorldNavigationProjectState["navigation"],
  viewportWidth: number,
  viewportHeight: number,
): ReadonlySet<string> {
  const allEntityIds = () => new Set(project.entities.map(({ id }) => id));
  if (
    !Number.isFinite(viewportWidth) ||
    viewportWidth <= 0 ||
    !Number.isFinite(viewportHeight) ||
    viewportHeight <= 0
  )
    return allEntityIds();

  const aspect = viewportWidth / viewportHeight;
  let far = worldNavigationFarPlane(navigation);
  try {
    far = Math.max(
      far,
      navigation.distance +
        worldTerrainGroundViewRadius(
          navigation.distance,
          aspect,
          navigation.target[1],
        ),
    );
  } catch {
    // Fall back to the shared navigation far plane for unsupported viewports.
  }
  const camera = new THREE.PerspectiveCamera(43, aspect, 0.1, far);
  const pose = worldNavigationCameraPose(navigation);
  camera.position.set(...pose.position);
  camera.lookAt(...pose.target);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  try {
    return selectVisibleWorldEntityIds(
      project.entities,
      boundsByEntity,
      camera,
    );
  } catch {
    return allEntityIds();
  }
}

function Scene({
  onReady,
  onInputLatency,
  onNavigationReady,
  onNavigationCommand,
  onNavigationClickSuppression,
  clearNavigationGestures,
  clearNavigationClickFallback,
  consumeNavigationClick,
  navigationGestureController,
  navigationEnabled,
  navigation,
  getNavigation,
}: {
  onReady?: () => void;
  onInputLatency?: (snapshot: PlayerInputLatencySnapshot) => void;
  onNavigationReady?: () => void;
  onNavigationCommand: (command: WorldNavigationCommand) => void;
  onNavigationClickSuppression: (pointerId: number) => void;
  clearNavigationGestures: () => void;
  clearNavigationClickFallback: () => void;
  consumeNavigationClick: (pointerId?: number) => boolean;
  navigationGestureController: WorldNavigationGestureController;
  navigationEnabled: boolean;
  navigation: WorldNavigationProjectState["navigation"];
  getNavigation: () => WorldNavigationProjectState["navigation"];
}) {
  const session = useMemo(() => new GameSession(), []);
  const project = useOrb((s) => s.project);
  const projectId = project.id;
  const phase = useOrb((s) => s.phase),
    revision = project.revision,
    entities = project.entities,
    environment = project.environment,
    playing = useOrb((s) => s.playing),
    selectedId = useOrb((s) => s.selected);
  const { camera, size, gl, scene } = useThree();
  const [initialPlayerPosition] = useState(() =>
    playerSpawnForProject(project),
  );
  const playerPositionRef = useRef<WorldNavigationVec3>(initialPlayerPosition);
  const initialPlaybackFocus = playbackFormationResidencyFocusCell(
    initialPlayerPosition,
  );
  const [playbackResidencyFocus, setPlaybackResidencyFocus] = useState(
    initialPlaybackFocus.focus,
  );
  const playbackResidencyFocusKey = useRef(initialPlaybackFocus.key);
  const navigationRaycaster = useMemo(() => new THREE.Raycaster(), []);
  const navigationNdc = useMemo(() => new THREE.Vector2(), []);
  const [followTerrainChunks, setFollowTerrainChunks] = useState<
    readonly WorldTerrainChunkKey[] | undefined
  >();
  const followTerrainSelectionKey = useRef<string | undefined>(undefined);
  const terrainAspect =
    size.width > 0 && size.height > 0 ? size.width / size.height : 1;
  const terrainChunks = useMemo(() => {
    try {
      return selectWorldTerrainChunks({
        focus: navigation.target,
        distance: navigation.distance,
        aspect: terrainAspect,
      });
    } catch (error) {
      if (error instanceof RangeError) return [];
      throw error;
    }
  }, [
    navigation.distance,
    navigation.target[0],
    navigation.target[1],
    navigation.target[2],
    terrainAspect,
  ]);
  const terrainFarPlane = useMemo(() => {
    try {
      return (
        navigation.distance +
        worldTerrainGroundViewRadius(
          navigation.distance,
          terrainAspect,
          navigation.target[1],
        )
      );
    } catch (error) {
      if (error instanceof RangeError)
        return worldNavigationFarPlane(navigation);
      throw error;
    }
  }, [navigation, terrainAspect, navigation.distance, navigation.target[1]]);
  const boundsByEntity = useMemo(
    () => worldNavigationBoundsByEntity(project),
    [project],
  );
  const visibleEntityIds = useMemo(() => {
    if (!navigationEnabled || phase !== "editing" || playing) return undefined;
    return visibleWebGLNavigationEntityIds(
      project,
      boundsByEntity,
      navigation,
      size.width,
      size.height,
    );
  }, [
    boundsByEntity,
    navigation,
    navigationEnabled,
    phase,
    playing,
    project,
    size.height,
    size.width,
  ]);
  const formationCompletionRecords = useRef<FormationCompletionRecords>(
    new Map(),
  );
  const recipeByEntity = useMemo(
    () =>
      new Map(
        entities.map((entity): [string, string] => [
          entity.id,
          formationRecipeIdentity(entity),
        ]),
      ),
    [entities],
  );
  const displayedRecipeScopeRef = useRef<DisplayedGameplayRecipeScope>({
    projectId,
    registry: new Map(),
  });
  displayedRecipeScopeRef.current = displayedGameplayRecipeScopeForProject(
    displayedRecipeScopeRef.current,
    projectId,
  );
  const displayedGameplayRecipes = displayedRecipeScopeRef.current.registry;
  const [completionEpoch, setCompletionEpoch] = useState(0);
  const completionRefreshPending = useRef(false);
  const notifyFormationComplete = useCallback(() => {
    if (completionRefreshPending.current) return;
    completionRefreshPending.current = true;
    queueMicrotask(() => {
      completionRefreshPending.current = false;
      setCompletionEpoch((current) => current + 1);
    });
  }, []);
  const resolvedScene = useMemo(() => {
    try {
      return resolveRuntimeScene(project);
    } catch {
      return undefined;
    }
  }, [project]);
  const hierarchicalScene = useMemo(
    () => usesSceneHierarchy(project),
    [project],
  );
  const proxyBoundsByEntity = useMemo(() => {
    const visualBounds = new Map<
      string,
      FormationProxyVisualBounds | undefined
    >();
    if (!resolvedScene) {
      for (const entity of entities) visualBounds.set(entity.id, undefined);
      return visualBounds;
    }
    for (const entity of entities)
      visualBounds.set(
        entity.id,
        formationProxyVisualBounds(
          boundsByEntity.get(entity.id),
          resolvedScene.entities.get(entity.id),
        ),
      );
    return visualBounds;
  }, [boundsByEntity, entities, resolvedScene]);
  const residencyCandidates = useMemo(() => {
    const completed = formationCompletionRecords.current.get(projectId);
    return entities.map((entity) => ({
      id: entity.id,
      stage: entity.stage,
      recipeIdentity: recipeByEntity.get(entity.id) ?? "",
      completedRecipeIdentity: completed?.get(entity.id),
      worldCenter: proxyBoundsByEntity.get(entity.id)?.center,
    }));
  }, [
    completionEpoch,
    entities,
    projectId,
    proxyBoundsByEntity,
    recipeByEntity,
  ]);
  const previousResidentScope = useRef<{
    projectId: string;
    residentIds: ReadonlySet<string>;
  }>({
    projectId,
    residentIds: new Set<string>(),
  });
  const residencyFocus = playing ? playbackResidencyFocus : navigation.target;
  const residencyNavigation = useMemo(
    () => worldNavigationFollowState(navigation, residencyFocus),
    [navigation, residencyFocus],
  );
  const allEntityIds = useMemo(
    () => new Set(entities.map((entity) => entity.id)),
    [entities],
  );
  const residencyVisibleIds = useMemo(() => {
    if (playing)
      return visibleWebGLNavigationEntityIds(
        project,
        boundsByEntity,
        residencyNavigation,
        size.width,
        size.height,
      );
    return visibleEntityIds ?? allEntityIds;
  }, [
    boundsByEntity,
    entities,
    allEntityIds,
    playing,
    project,
    residencyNavigation,
    size.height,
    size.width,
    visibleEntityIds,
  ]);
  const residencyPresentation = useMemo(
    () =>
      selectFormationResidencyPresentation({
        candidates: residencyCandidates,
        focus: residencyFocus,
        visibleIds: residencyVisibleIds,
        selectedId,
        previousResidentIds:
          previousResidentScope.current.projectId === projectId
            ? previousResidentScope.current.residentIds
            : undefined,
        enabled: phase === "editing" && (playing || navigationEnabled),
      }),
    [
      navigationEnabled,
      phase,
      playing,
      projectId,
      residencyCandidates,
      residencyFocus,
      residencyVisibleIds,
      selectedId,
    ],
  );
  useLayoutEffect(() => {
    previousResidentScope.current = {
      projectId,
      residentIds: residencyPresentation.residentIds,
    };
  }, [projectId, residencyPresentation.residentIds]);
  const navigationEnabledRef = useRef(navigationEnabled);
  navigationEnabledRef.current =
    navigationEnabled && phase === "editing" && !playing;
  const reviewEntitiesRef = useRef(entities);
  useLayoutEffect(() => {
    reconcileFormationCompletionRecords(
      formationCompletionRecords.current,
      projectId,
      recipeByEntity,
    );
  }, [projectId, recipeByEntity]);
  useLayoutEffect(() => {
    const currentIds = new Set(entities.map((entity) => entity.id));
    for (const id of displayedGameplayRecipes.keys())
      if (!currentIds.has(id)) displayedGameplayRecipes.delete(id);
  }, [displayedGameplayRecipes, entities]);
  const reviewFrameRef = useRef<
    | {
        projectId: string;
        revision: number;
      }
    | undefined
  >(undefined);
  const reviewFramePendingRef = useRef<
    { projectId: string; revision: number } | undefined
  >(undefined);
  const reviewMetaRef = useRef({ projectId, revision, phase });
  useLayoutEffect(() => {
    reviewEntitiesRef.current = entities;
    reviewMetaRef.current = { projectId, revision, phase };
    notifySceneReviewCaptureChanged();
  }, [entities, phase, projectId, revision]);
  const formationReviewStates = useRef(new Map<string, FormationReviewState>());
  const reviewMounted = useRef(false);
  const reviewTransitionSettled = useRef(false);
  const setFormationReviewState = useCallback(
    (id: string, state: FormationReviewState | undefined) => {
      if (state) formationReviewStates.current.set(id, state);
      else formationReviewStates.current.delete(id);
      notifySceneReviewCaptureChanged();
    },
    [],
  );
  useEffect(() => {
    reviewMounted.current = true;
    const source = {
      renderer: "webgl",
      getState: (): SceneReviewSourceState => {
        const meta = reviewMetaRef.current;
        const expectedIds = reviewEntitiesRef.current.map(
          (entity) => entity.id,
        );
        const states = expectedIds.map((id) =>
          formationReviewStates.current.get(id)?.(),
        );
        const pendingAssetIds = expectedIds.filter((_, index) => {
          const state = states[index];
          return !state || state.pending;
        });
        const failedAssetIds = expectedIds.filter(
          (_, index) => states[index]?.failed,
        );
        const readyAssetIds = expectedIds.filter(
          (_, index) => states[index]?.ready,
        );
        const errors = states.flatMap((state) =>
          state?.error ? [state.error] : [],
        );
        const formationsReady =
          states.length === expectedIds.length && states.every(Boolean);
        const formationRevision = formationsReady
          ? expectedIds.length > 0
            ? Math.min(...states.map((state) => state!.renderedRevision))
            : meta.revision
          : -1;
        const renderedRevision =
          reviewFrameRef.current?.projectId === meta.projectId &&
          reviewFrameRef.current.revision === meta.revision
            ? formationRevision
            : -1;
        return {
          renderer: "webgl",
          projectId: meta.projectId,
          revision: meta.revision,
          renderedRevision,
          transitionSettled:
            meta.phase === "editing" &&
            reviewTransitionSettled.current &&
            parcelTransitionController.snapshot.settled,
          mounted: reviewMounted.current,
          readyAssetIds,
          pendingAssetIds,
          failedAssetIds,
          errors,
        };
      },
      capture: () => {
        gl.render(scene, camera);
        return captureSceneCanvas(gl.domElement);
      },
    } as const;
    const unregister = registerSceneReviewCaptureSource(source);
    const fixtureProbe = (
      globalThis as typeof globalThis & {
        __orbsieSceneReviewFixture?: {
          webgl?: {
            capture: typeof captureSceneReview;
            read: () => SceneReviewSourceState;
          };
        };
      }
    ).__orbsieSceneReviewFixture;
    const fixtureEntry = {
      capture: captureSceneReview,
      read: source.getState,
    };
    if (fixtureProbe) fixtureProbe.webgl = fixtureEntry;
    notifySceneReviewCaptureChanged();
    return () => {
      reviewMounted.current = false;
      reviewFramePendingRef.current = undefined;
      reviewFrameRef.current = undefined;
      if (fixtureProbe?.webgl === fixtureEntry) delete fixtureProbe.webgl;
      unregister();
      notifySceneReviewCaptureChanged();
    };
  }, [camera, gl, scene]);
  useEffect(
    () =>
      registerPublicationThumbnail(() => {
        gl.render(scene, camera);
        const thumbnail = document.createElement("canvas");
        thumbnail.width = 320;
        thumbnail.height = 180;
        const context = thumbnail.getContext("2d");
        if (!context) throw new Error("Could not capture a world preview.");
        const scale = Math.min(
          thumbnail.width / gl.domElement.width,
          thumbnail.height / gl.domElement.height,
        );
        const width = gl.domElement.width * scale;
        const height = gl.domElement.height * scale;
        context.fillStyle = "#07100f";
        context.fillRect(0, 0, thumbnail.width, thumbnail.height);
        context.drawImage(
          gl.domElement,
          (thumbnail.width - width) / 2,
          (thumbnail.height - height) / 2,
          width,
          height,
        );
        return thumbnail.toDataURL("image/png");
      }),
    [gl, scene, camera],
  );
  const progress = useRef(0);
  const spin = useRef(0);
  const island = useRef<THREE.Group>(null);
  const gameplayVisibility = useMemo<GameplayRenderVisibility>(
    () => ({
      frustum: new THREE.Frustum(),
      projectionView: new THREE.Matrix4(),
      ready: false,
    }),
    [],
  );
  const workspaceWorldFrame = useRef<THREE.Group>(null);
  const renderOrigin = useRef<RenderOriginVec3>(ZERO_RENDER_ORIGIN);
  const transitionSurface = useRef<THREE.Group>(null);
  const defaultGround = useRef<THREE.Group>(null);
  const initialized = useRef(false);
  const frame = useMemo(() => parcelFrame(projectId), [projectId]);
  const alignment = useMemo(
    () =>
      new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(...frame.normal),
        new THREE.Vector3(0, 0, 1),
      ),
    [frame],
  );
  const spinQuaternion = useMemo(() => new THREE.Quaternion(), []);
  const surfaceOrientation = useMemo(() => new THREE.Quaternion(), []);
  const flatQuaternion = useMemo(() => new THREE.Quaternion(), []);
  const localNormal = useMemo(
    () => new THREE.Vector3(...frame.normal),
    [frame],
  );
  const surfaceNormal = useMemo(() => new THREE.Vector3(), []);
  const surfaceEast = useMemo(() => new THREE.Vector3(), []);
  const surfaceZ = useMemo(() => new THREE.Vector3(), []);
  const surfacePosition = useMemo(() => new THREE.Vector3(), []);
  const patchQuaternion = useMemo(() => new THREE.Quaternion(), []);
  const tangentMatrix = useMemo(() => new THREE.Matrix4(), []);
  const origin = useMemo(() => new THREE.Vector3(), []);
  const cameraStart = useMemo(() => new THREE.Vector3(), []);
  const cameraEnd = useMemo(() => new THREE.Vector3(), []);
  const landingPose = useMemo(
    () => worldNavigationCameraPose(navigation),
    [navigation],
  );
  const navigationReadyNotified = useRef(false);
  const initializedScene = useRef(false);
  const previousProjectId = useRef(projectId);
  const previousPhase = useRef(phase);
  useLayoutEffect(() => {
    const firstMount = !initializedScene.current;
    const projectChanged = previousProjectId.current !== projectId;
    const directWorkspace =
      phase === "editing" &&
      previousPhase.current === "landing" &&
      !projectChanged;
    if (firstMount)
      parcelTransitionController.reset(
        phase === "landing" || phase === "descending" ? 0 : 1,
      );
    else if (phase === "landing")
      projectChanged
        ? parcelTransitionController.reset(0)
        : parcelTransitionController.setTarget(0);
    else if (projectChanged || directWorkspace)
      parcelTransitionController.reset(phase === "descending" ? 0 : 1);
    else parcelTransitionController.setTarget(1);
    initializedScene.current = true;
    previousProjectId.current = projectId;
    previousPhase.current = phase;
    spin.current = parcelTransitionController.snapshot.spin;
    progress.current = parcelTransitionController.snapshot.progress;
    initialized.current = false;
    renderOrigin.current = ZERO_RENDER_ORIGIN;
    applyWebGLRenderOrigin(workspaceWorldFrame.current, renderOrigin.current);
    navigationReadyNotified.current = false;
    notifySceneReviewCaptureChanged();
  }, [phase, projectId]);
  useEffect(() => parcelTransitionController.attachRenderer(), []);
  useEffect(() => {
    navigationGestureController.reset();
    if (!navigationEnabledRef.current) {
      clearNavigationGestures();
      return;
    }

    const canvas = gl.domElement;
    // The scene owns touch pan/pinch while editing; DOM overlays remain
    // separate targets and retain their own scroll and control behavior.
    const previousTouchAction = canvas.style.touchAction;
    canvas.style.touchAction = "none";
    const rotatingPointers = new Set<number>();
    let pendingContextMenuPointer: number | null = null;
    let contextMenuTimeout: ReturnType<typeof setTimeout> | undefined;

    const clearTransientState = () => {
      rotatingPointers.clear();
      pendingContextMenuPointer = null;
      if (contextMenuTimeout !== undefined) {
        clearTimeout(contextMenuTimeout);
        contextMenuTimeout = undefined;
      }
    };
    const resetGestureState = () => {
      clearTransientState();
      clearNavigationGestures();
    };
    const getViewport = () => {
      const rect = canvas.getBoundingClientRect();
      const currentNavigation = getNavigation();
      if (camera instanceof THREE.PerspectiveCamera) {
        return {
          width: rect.width,
          height: rect.height,
          verticalFovRadians: (camera.fov * Math.PI) / 180,
          distance: currentNavigation.distance,
          heading: currentNavigation.heading,
        };
      }
      return {
        width: rect.width,
        height: rect.height,
        verticalFovRadians: (43 * Math.PI) / 180,
        distance: currentNavigation.distance,
        heading: currentNavigation.heading,
      };
    };
    const hitNavigationObject = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return false;
      navigationNdc.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      navigationRaycaster.near = camera.near;
      navigationRaycaster.far = camera.far;
      navigationRaycaster.setFromCamera(navigationNdc, camera);
      const intersections = navigationRaycaster.intersectObjects(
        scene.children,
        true,
      );
      const nearestRelevant = intersections.find((intersection) => {
        let object: THREE.Object3D | null = intersection.object;
        let entityHit = false;
        let visible = true;
        while (object && object !== scene) {
          if (!object.visible) visible = false;
          if (object.userData.orbsieNavigationHit === true) entityHit = true;
          object = object.parent;
        }
        if (!visible) return false;
        if (entityHit) return true;
        if (!(intersection.object instanceof THREE.Mesh)) return false;
        const materials = Array.isArray(intersection.object.material)
          ? intersection.object.material
          : [intersection.object.material];
        return materials.some(
          (material) => !material.transparent && material.opacity >= 0.95,
        );
      });
      if (!nearestRelevant) return false;
      let object: THREE.Object3D | null = nearestRelevant.object;
      while (object && object !== scene) {
        if (object.userData.orbsieNavigationHit === true) return true;
        object = object.parent;
      }
      return false;
    };
    const handlePointerDown = (event: PointerEvent) => {
      if (!navigationEnabledRef.current) return;
      // A prior touch gesture may not synthesize a click. Expire its
      // pointer-less fallback when a later scene interaction begins.
      clearNavigationClickFallback();
      if (pendingContextMenuPointer !== null) {
        pendingContextMenuPointer = null;
        if (contextMenuTimeout !== undefined) {
          clearTimeout(contextMenuTimeout);
          contextMenuTimeout = undefined;
        }
      }
      const pointerType =
        event.pointerType === "touch"
          ? "touch"
          : event.pointerType === "mouse"
            ? "mouse"
            : undefined;
      if (!pointerType) return;
      const button =
        event.button === 0
          ? "primary"
          : event.button === 2
            ? "secondary"
            : "other";
      navigationGestureController.pointerDown({
        pointerId: event.pointerId,
        pointerType,
        x: event.clientX,
        y: event.clientY,
        button,
        objectHit: hitNavigationObject(event),
      });
    };
    const handlePointerMove = (event: PointerEvent) => {
      if (!navigationEnabledRef.current) return;
      const result = navigationGestureController.pointerMove(
        { pointerId: event.pointerId, x: event.clientX, y: event.clientY },
        getViewport(),
      );
      if (result.suppressClick) onNavigationClickSuppression(event.pointerId);
      for (const command of result.commands) {
        if (command.type === "rotate_to_heading")
          rotatingPointers.add(event.pointerId);
        onNavigationCommand(command);
      }
      if (result.handled && event.cancelable) event.preventDefault();
    };
    const handlePointerUp = (event: PointerEvent) => {
      const result = navigationGestureController.pointerUp(event.pointerId);
      if (result.suppressClick) onNavigationClickSuppression(event.pointerId);
      if (rotatingPointers.delete(event.pointerId)) {
        pendingContextMenuPointer = event.pointerId;
        if (contextMenuTimeout !== undefined) clearTimeout(contextMenuTimeout);
        contextMenuTimeout = setTimeout(() => {
          pendingContextMenuPointer = null;
          contextMenuTimeout = undefined;
        }, 750);
      }
    };
    const handlePointerCancel = (event: PointerEvent) => {
      navigationGestureController.pointerCancel(event.pointerId);
      rotatingPointers.delete(event.pointerId);
      if (pendingContextMenuPointer === event.pointerId) {
        pendingContextMenuPointer = null;
        if (contextMenuTimeout !== undefined) {
          clearTimeout(contextMenuTimeout);
          contextMenuTimeout = undefined;
        }
      }
    };
    const handleWheel = (event: WheelEvent) => {
      if (!navigationEnabledRef.current) return;
      const rect = canvas.getBoundingClientRect();
      const pixelMultiplier =
        event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? 16
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? rect.height
            : 1;
      const result = navigationGestureController.wheel(
        { deltaY: event.deltaY * pixelMultiplier },
        getViewport(),
      );
      for (const command of result.commands) onNavigationCommand(command);
      if (result.handled && event.cancelable) event.preventDefault();
    };
    const handleContextMenu = (event: MouseEvent) => {
      if (rotatingPointers.size > 0 || pendingContextMenuPointer !== null) {
        event.preventDefault();
        pendingContextMenuPointer = null;
        if (contextMenuTimeout !== undefined) {
          clearTimeout(contextMenuTimeout);
          contextMenuTimeout = undefined;
        }
      }
    };
    const handleVisibilityChange = () => {
      if (document.hidden) resetGestureState();
    };

    canvas.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("pointermove", handlePointerMove, {
      capture: true,
      passive: false,
    });
    window.addEventListener("pointerup", handlePointerUp, true);
    window.addEventListener("pointercancel", handlePointerCancel, true);
    canvas.addEventListener("wheel", handleWheel, {
      capture: true,
      passive: false,
    });
    canvas.addEventListener("contextmenu", handleContextMenu, true);
    window.addEventListener("blur", resetGestureState);
    window.addEventListener("resize", resetGestureState);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    let observedCanvasSize: readonly [number, number] | undefined;
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver((entries) => {
            const entry = entries[entries.length - 1];
            if (!entry) return;
            const nextSize: readonly [number, number] = [
              entry.contentRect.width,
              entry.contentRect.height,
            ];
            if (
              observedCanvasSize &&
              (observedCanvasSize[0] !== nextSize[0] ||
                observedCanvasSize[1] !== nextSize[1])
            )
              resetGestureState();
            observedCanvasSize = nextSize;
          });
    resizeObserver?.observe(canvas);

    return () => {
      canvas.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("pointermove", handlePointerMove, true);
      window.removeEventListener("pointerup", handlePointerUp, true);
      window.removeEventListener("pointercancel", handlePointerCancel, true);
      canvas.removeEventListener("wheel", handleWheel, true);
      canvas.removeEventListener("contextmenu", handleContextMenu, true);
      window.removeEventListener("blur", resetGestureState);
      window.removeEventListener("resize", resetGestureState);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      resizeObserver?.disconnect();
      canvas.style.touchAction = previousTouchAction;
      resetGestureState();
    };
  }, [
    camera,
    clearNavigationGestures,
    clearNavigationClickFallback,
    gl,
    getNavigation,
    navigationEnabled,
    navigationGestureController,
    navigationNdc,
    navigationRaycaster,
    onNavigationClickSuppression,
    onNavigationCommand,
    projectId,
    scene,
  ]);
  useFrame((_, dt) => {
    if (playing && phase === "editing") {
      const nextFocusCell = playbackFormationResidencyFocusCell(
        playerPositionRef.current,
      );
      if (nextFocusCell.key !== playbackResidencyFocusKey.current) {
        playbackResidencyFocusKey.current = nextFocusCell.key;
        setPlaybackResidencyFocus(nextFocusCell.focus);
      }
    }
    gameplayVisibility.ready = false;
    const target = phase === "landing" ? 0 : 1;
    parcelTransitionController.setTarget(target);
    const snapshot = parcelTransitionController.step(dt, reduced());
    const transitionSettled = phase === "editing" && snapshot.settled;
    const workspaceSettled =
      phase === "editing" && snapshot.settled && snapshot.progress >= 1;
    if (!workspaceSettled) {
      renderOrigin.current = ZERO_RENDER_ORIGIN;
      applyWebGLRenderOrigin(workspaceWorldFrame.current, renderOrigin.current);
    }
    if (transitionSurface.current)
      transitionSurface.current.visible = !workspaceSettled;
    if (defaultGround.current) defaultGround.current.visible = workspaceSettled;
    if (transitionSettled !== reviewTransitionSettled.current) {
      reviewTransitionSettled.current = transitionSettled;
      notifySceneReviewCaptureChanged();
    }
    progress.current = snapshot.progress;
    spin.current = snapshot.spin;
    const t = progress.current;
    if (phase === "landing" || t < 1 || !initialized.current) {
      const mobile = size.width < 700;
      cameraStart.set(0, 1.8, mobile ? 14.5 : 10.2);
      cameraEnd.set(...landingPose.position);
      camera.position.copy(cameraStart.lerp(cameraEnd, t));
      const look = worldNavigationLandingLookTarget(t, landingPose.target);
      camera.lookAt(...look);
      initialized.current = t > 0.99;
    }
    const playViewActive =
      playing &&
      phase === "editing" &&
      snapshot.settled &&
      snapshot.progress >= 1 &&
      initialized.current;
    const activeNavigation = playViewActive
      ? worldNavigationFollowState(navigation, playerPositionRef.current)
      : navigation;
    if (playViewActive) {
      const terrainCell = worldTerrainChunkKeyAt(
        activeNavigation.target[0],
        activeNavigation.target[2],
        0,
      );
      // Chunk refreshes happen only after a world-aligned cell crossing (or
      // projection/zoom change), never for each player simulation tick.
      const conservativeHeightBucket = Math.ceil(
        activeNavigation.target[1] / 4,
      );
      const selectionKey = [
        terrainCell.x,
        terrainCell.z,
        conservativeHeightBucket,
        activeNavigation.distance,
        terrainAspect,
      ].join(":");
      if (followTerrainSelectionKey.current !== selectionKey) {
        followTerrainSelectionKey.current = selectionKey;
        try {
          setFollowTerrainChunks(
            selectWorldTerrainChunks({
              focus: [
                activeNavigation.target[0],
                conservativeHeightBucket * 4,
                activeNavigation.target[2],
              ],
              distance: activeNavigation.distance,
              aspect: terrainAspect,
            }),
          );
        } catch {
          setFollowTerrainChunks([]);
        }
      }
    } else if (followTerrainSelectionKey.current !== undefined) {
      followTerrainSelectionKey.current = undefined;
      setFollowTerrainChunks(undefined);
    }
    if (
      phase === "editing" &&
      snapshot.settled &&
      snapshot.progress >= 1 &&
      initialized.current
    ) {
      if (!navigationReadyNotified.current) {
        navigationReadyNotified.current = true;
        onNavigationReady?.();
      }
      const worldPose = worldNavigationCameraPose(activeNavigation);
      let nextRenderOrigin = selectRenderOrigin(
        activeNavigation.target,
        renderOrigin.current,
      );
      let pose = worldCameraPoseToRenderLocal(worldPose, nextRenderOrigin);
      if (!pose) {
        nextRenderOrigin = ZERO_RENDER_ORIGIN;
        pose = worldPose;
      }
      renderOrigin.current = nextRenderOrigin;
      applyWebGLRenderOrigin(workspaceWorldFrame.current, nextRenderOrigin);
      camera.position.set(...pose.position);
      camera.lookAt(...pose.target);
      const perspectiveCamera = camera as THREE.PerspectiveCamera;
      let activeTerrainFarPlane = terrainFarPlane;
      if (playViewActive) {
        try {
          activeTerrainFarPlane =
            activeNavigation.distance +
            worldTerrainGroundViewRadius(
              activeNavigation.distance,
              terrainAspect,
              activeNavigation.target[1],
            );
        } catch {
          activeTerrainFarPlane = worldNavigationFarPlane(activeNavigation);
        }
      }
      const far = Math.max(
        worldNavigationFarPlane(activeNavigation),
        activeTerrainFarPlane,
      );
      if (perspectiveCamera.far !== far) {
        perspectiveCamera.far = far;
        perspectiveCamera.updateProjectionMatrix();
      }
    }
    if (target === 1 && snapshot.settled) {
      const current = useOrb.getState();
      if (current.project.id === projectId && current.phase === "descending")
        current.set({ phase: "editing" });
    }
    const currentProject = useOrb.getState().project;
    const paintedFrame = reviewFrameRef.current;
    if (
      (paintedFrame?.projectId !== currentProject.id ||
        paintedFrame.revision !== currentProject.revision) &&
      !(
        reviewFramePendingRef.current?.projectId === currentProject.id &&
        reviewFramePendingRef.current.revision === currentProject.revision
      )
    ) {
      const nextFrame = {
        projectId: currentProject.id,
        revision: currentProject.revision,
      };
      reviewFramePendingRef.current = nextFrame;
      // R3F runs useFrame callbacks before its renderer call. Commit this
      // marker in a microtask so a source cannot claim a painted revision
      // before the current frame has reached the GPU.
      queueMicrotask(() => {
        if (reviewFramePendingRef.current !== nextFrame) return;
        reviewFramePendingRef.current = undefined;
        reviewFrameRef.current = nextFrame;
        notifySceneReviewCaptureChanged();
      });
    }
    if (island.current) {
      const blend = patchBlend(t);
      spinQuaternion.setFromAxisAngle(
        localNormal,
        frame.spinPhase + snapshot.spin,
      );
      surfaceOrientation.copy(alignment).multiply(spinQuaternion);
      surfaceNormal.set(...frame.normal).applyQuaternion(surfaceOrientation);
      surfaceEast.set(...frame.east).applyQuaternion(surfaceOrientation);
      surfaceZ.copy(surfaceEast).cross(surfaceNormal).normalize();
      tangentMatrix.makeBasis(surfaceEast, surfaceNormal, surfaceZ);
      patchQuaternion.setFromRotationMatrix(tangentMatrix);
      island.current.visible = blend > 0.001 || phase !== "landing";
      surfacePosition.copy(surfaceNormal).multiplyScalar(3 * globeScale(t));
      surfacePosition.y += globeOffsetY(t);
      island.current.position.lerpVectors(surfacePosition, origin, blend);
      island.current.quaternion.slerpQuaternions(
        patchQuaternion,
        flatQuaternion,
        blend,
      );
      island.current.scale.setScalar(Math.max(0.001, blend));
    }
    if (playViewActive)
      gameplayVisibility.ready = updateGameplayRenderVisibility(
        gameplayVisibility,
        camera,
      );
  }, -0.5);
  return (
    <>
      {phase !== "editing" && (
        <Stars
          radius={80}
          depth={50}
          count={1600}
          factor={2.5}
          saturation={0.2}
          fade
          speed={0.2}
        />
      )}
      <ambientLight intensity={phase === "landing" ? 0.45 : 1.6} />
      <hemisphereLight
        args={["#daeaff", "#142a38", phase === "landing" ? 0.7 : 1.5]}
      />
      <directionalLight
        position={WEBGL_LOCAL_KEY_LIGHT_POSITION}
        intensity={phase === "landing" ? 3.5 : 2.5}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-12}
        shadow-camera-right={12}
        shadow-camera-top={12}
        shadow-camera-bottom={-12}
        shadow-normalBias={0.05}
      />
      <Planet progress={progress} frame={frame} spin={spin} />
      {/* One parent translation offsets world-space entities and terrain exactly once. */}
      <group ref={workspaceWorldFrame}>
        <group ref={island} visible={false}>
          <group ref={transitionSurface}>
            <mesh position={[0, -0.65, 0]} receiveShadow>
              <cylinderGeometry args={[8.6, 7.5, 1.2, 80]} />
              <meshStandardMaterial color="#dfd3a6" roughness={1} />
            </mesh>
            <mesh position={[0, -0.07, 0]} receiveShadow>
              <cylinderGeometry args={[8.55, 8.6, 0.12, 80]} />
              <meshStandardMaterial color={environment.ground} roughness={1} />
            </mesh>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.75, 0]}>
              <circleGeometry args={[40, 80]} />
              <meshStandardMaterial
                color={environment.water}
                roughness={0.6}
                transparent
                opacity={0.38}
              />
            </mesh>
            <Pebbles />
            <ContactShadows
              position={[0, -0.77, 0]}
              opacity={0.17}
              scale={28}
              blur={2.5}
              far={10}
              resolution={256}
              frames={1}
            />
          </group>
          {entities.map((e) => {
            const recipeIdentity = recipeByEntity.get(e.id) ?? "";
            const visualBounds = proxyBoundsByEntity.get(e.id);
            if (
              residencyPresentation.proxyIds.has(e.id) &&
              visualBounds &&
              resolvedScene
            )
              return (
                <FormationProxy
                  key={`${projectId}/${e.id}`}
                  entity={e}
                  recipeIdentity={recipeIdentity}
                  visualBounds={visualBounds}
                  resolvedScene={resolvedScene}
                  hierarchical={hierarchicalScene}
                  projectId={projectId}
                  revision={revision}
                  visible={residencyVisibleIds.has(e.id)}
                  session={session}
                  onReviewState={setFormationReviewState}
                  consumeNavigationClick={consumeNavigationClick}
                />
              );
            if (!residencyPresentation.fullFormationIds.has(e.id)) return null;
            return (
              <Formation
                key={`${projectId}/${e.id}`}
                entity={e}
                visible={visibleEntityIds?.has(e.id) ?? true}
                gameplayVisibility={gameplayVisibility}
                completionRecords={formationCompletionRecords.current}
                recipeIdentity={recipeIdentity}
                displayedGameplayRecipes={displayedGameplayRecipes}
                onFormationComplete={notifyFormationComplete}
                session={session}
                revision={revision}
                onReviewState={setFormationReviewState}
                consumeNavigationClick={consumeNavigationClick}
              />
            );
          })}
          <Player
            session={session}
            followPositionRef={playerPositionRef}
            displayedGameplayRecipes={displayedGameplayRecipes}
            recipeByEntity={recipeByEntity}
            onReady={onReady}
            onInputLatency={onInputLatency}
          />
        </group>
        <group ref={defaultGround} visible={false}>
          {(followTerrainChunks ?? terrainChunks).map((chunk) => (
            <WorldTerrainChunk
              key={`${chunk.lod}:${chunk.x}:${chunk.z}`}
              chunk={chunk}
              color={environment.ground}
            />
          ))}
        </group>
      </group>
    </>
  );
}
const webglUnavailableMessage =
  "Your world needs WebGL2, but WebGL2 could not initialize in this browser.";
export function isAndroidEmulatorSwiftShaderRenderer(
  rendererName: unknown,
): boolean {
  return (
    typeof rendererName === "string" &&
    /Android Emulator OpenGL ES Translator\s+\(Google SwiftShader\)/i.test(
      rendererName,
    )
  );
}
function hasAndroidEmulatorSwiftShaderRenderer(): boolean {
  if (typeof document === "undefined") return false;
  const canvas = document.createElement("canvas");
  let context: WebGL2RenderingContext | null = null;
  try {
    context = canvas.getContext("webgl2", {
      alpha: true,
      antialias: true,
      powerPreference: "high-performance",
    });
    if (!context) return false;
    const debugRendererInfo = context.getExtension(
      "WEBGL_debug_renderer_info",
    ) as { UNMASKED_RENDERER_WEBGL: number } | null;
    if (!debugRendererInfo) return false;
    return isAndroidEmulatorSwiftShaderRenderer(
      context.getParameter(debugRendererInfo.UNMASKED_RENDERER_WEBGL),
    );
  } catch {
    // Renderer identification is optional; keep WebGL when the browser hides
    // the debug extension or rejects the query.
    return false;
  } finally {
    try {
      context?.getExtension("WEBGL_lose_context")?.loseContext();
    } catch {
      // Dropping the detached canvas below still releases the probe reference.
    }
    canvas.width = 0;
    canvas.height = 0;
    context = null;
  }
}
function CanvasFallback() {
  // Show this placeholder while selecting a renderer and inside R3F's canvas
  // fallback. Keep transient copy out of the accessibility tree; actionable
  // failures use Unavailable or GraphicsGuidance below.
  return (
    <div className="webgl-fallback" aria-hidden="true">
      <span>Preparing graphics…</span>
    </div>
  );
}
function Unavailable() {
  return (
    <div className="webgl-fallback">
      <strong>Graphics are unavailable</strong>
      <p>
        WebGL2 and the software canvas renderer could not initialize. The
        browser does not expose whether hardware acceleration is disabled.
      </p>
    </div>
  );
}
class Boundary extends Component<
  { children: ReactNode; onError?: (message: string) => void },
  { error: boolean }
> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  componentDidCatch() {
    this.props.onError?.(webglUnavailableMessage);
  }
  render() {
    return this.state.error ? (
      this.props.onError ? null : (
        <div className="webgl-fallback">
          <strong>Graphics are unavailable</strong>
          <p>
            WebGL2 and the software canvas renderer could not initialize. Your
            saved world is safe.
          </p>
        </div>
      )
    ) : (
      this.props.children
    );
  }
}

function navigationZoomLabel(state: WorldNavigationProjectState["navigation"]) {
  const percent = (WORLD_NAVIGATION_DEFAULT_DISTANCE / state.distance) * 100;
  if (!Number.isFinite(percent) || percent < 0.01) return "<0.01%";
  return `${percent >= 10 ? percent.toFixed(0) : percent.toFixed(1)}%`;
}

function WorldNavigationControls({
  state,
  notice,
  enabled,
  onCommand,
  onFrame,
}: {
  state: WorldNavigationProjectState["navigation"];
  notice: string;
  enabled: boolean;
  onCommand: (command: WorldNavigationCommand) => void;
  onFrame: () => void;
}) {
  const headingDegrees = Math.round((state.heading * 180) / Math.PI) % 360;
  const headingLabel = `${String(headingDegrees).padStart(3, "0")}°`;
  const zoom = navigationZoomLabel(state);
  return (
    <div
      className="world-navigation-controls"
      role="group"
      aria-label="World navigation"
    >
      <button
        type="button"
        aria-label={`Zoom in, currently ${zoom}`}
        title={`Zoom in · ${zoom}`}
        disabled={!enabled}
        onClick={() => onCommand({ type: "zoom", factor: 0.8 })}
      >
        <Plus size={17} aria-hidden="true" />
        <span>{zoom}</span>
      </button>
      <button
        type="button"
        aria-label={`Zoom out, currently ${zoom}`}
        title={`Zoom out · ${zoom}`}
        disabled={!enabled}
        onClick={() => onCommand({ type: "zoom", factor: 1.25 })}
      >
        <Minus size={17} aria-hidden="true" />
        <span>{zoom}</span>
      </button>
      <button
        type="button"
        className="world-navigation-compass"
        aria-label={`Reset north. Current heading ${headingDegrees} degrees.`}
        title={`Reset north · ${headingLabel}`}
        disabled={!enabled}
        onClick={() => onCommand({ type: "north_reset" })}
      >
        <svg
          className="world-navigation-north-arrow"
          viewBox="0 0 20 20"
          style={{ transform: `rotate(${-headingDegrees}deg)` }}
          aria-hidden="true"
        >
          <path d="M10 1 15.5 19 10 15.8 4.5 19 10 1Z" />
        </svg>
        <span>{headingLabel}</span>
      </button>
      <button
        type="button"
        aria-label="Frame content"
        title="Frame content"
        disabled={!enabled}
        onClick={onFrame}
      >
        <Scan size={16} aria-hidden="true" />
        <span>Frame</span>
      </button>
      <span
        className="world-navigation-notice"
        role="status"
        aria-live="polite"
      >
        {notice}
      </span>
    </div>
  );
}

export default function World({
  onReady,
  onRendererReady,
  onError,
  onInputLatency,
  onRendererFallback,
  rendererRetryToken = 0,
}: {
  onReady?: () => void;
  onRendererReady?: (renderer?: "webgl" | "software") => void;
  onError?: (message: string) => void;
  onInputLatency?: (snapshot: PlayerInputLatencySnapshot) => void;
  onRendererFallback?: (message: string) => void;
  rendererRetryToken?: number;
} = {}) {
  const project = useOrb((state) => state.project);
  const projectId = project.id;
  const phase = useOrb((state) => state.phase);
  const building = useOrb((state) => state.building);
  const playing = useOrb((state) => state.playing);
  const error = useOrb((state) => state.error);
  const generationRecovery = useOrb((state) => state.generationRecovery);
  const pendingInitialFrameRef = useRef<InitialProjectFrameAttempt | null>(
    null,
  );
  const previousInitialFrameLifecycleRef = useRef<InitialProjectFrameLifecycle>(
    {
      projectId,
      phase,
      building,
      entityCount: project.entities.length,
    },
  );
  const navigationGestureController = useMemo(
    () => new WorldNavigationGestureController(),
    [],
  );
  const suppressedClickPointerId = useRef<number | null>(null);
  const clearNavigationGestures = useCallback(() => {
    navigationGestureController.reset();
    suppressedClickPointerId.current = null;
  }, [navigationGestureController]);
  const markNavigationClickSuppressed = useCallback((pointerId: number) => {
    suppressedClickPointerId.current = pointerId;
  }, []);
  const clearNavigationClickFallback = useCallback(() => {
    suppressedClickPointerId.current = null;
  }, []);
  const consumeNavigationClick = useCallback(
    (pointerId?: number) => {
      const candidate =
        pointerId ?? suppressedClickPointerId.current ?? undefined;
      if (candidate === undefined) return false;
      const consumed =
        navigationGestureController.consumeClickSuppression(candidate);
      if (consumed && suppressedClickPointerId.current === candidate)
        suppressedClickPointerId.current = null;
      return consumed;
    },
    [navigationGestureController],
  );
  const [navigationProject, setNavigationProject] = useState(() =>
    worldNavigationProjectState(projectId),
  );
  const navigationProjectRef = useRef(navigationProject);
  navigationProjectRef.current = navigationProject;
  const navigation =
    navigationProject.projectId === projectId
      ? navigationProject.navigation
      : createWorldNavigationState();
  const getNavigation = useCallback(
    () =>
      navigationProjectRef.current.projectId === projectId
        ? navigationProjectRef.current.navigation
        : createWorldNavigationState(),
    [projectId],
  );
  const [navigationNotice, setNavigationNotice] = useState("");
  const [navigationReady, setNavigationReady] = useState(false);
  const previousRendererRetryToken = useRef(rendererRetryToken);
  useLayoutEffect(() => {
    const rendererAttemptChanged =
      previousRendererRetryToken.current !== rendererRetryToken;
    previousRendererRetryToken.current = rendererRetryToken;
    clearNavigationGestures();
    if (
      rendererAttemptChanged ||
      phase === "landing" ||
      phase === "descending" ||
      navigationProjectRef.current.projectId !== projectId
    ) {
      setNavigationReady(false);
      setNavigationNotice("");
    }
    setNavigationProject((previous) => {
      const next = worldNavigationProjectState(projectId, previous);
      navigationProjectRef.current = next;
      return next;
    });
  }, [clearNavigationGestures, phase, playing, projectId, rendererRetryToken]);
  useEffect(() => () => clearNavigationGestures(), [clearNavigationGestures]);
  const dispatchNavigation = useCallback(
    (command: WorldNavigationCommand, userInitiated = true) => {
      const pendingInitialFrame = pendingInitialFrameRef.current;
      if (userInitiated && pendingInitialFrame?.projectId === projectId)
        pendingInitialFrame.userNavigated = true;
      const current = worldNavigationProjectState(
        projectId,
        navigationProjectRef.current,
      );
      try {
        const next = {
          ...current,
          navigation: applyWorldNavigationCommand(current.navigation, command),
        };
        navigationProjectRef.current = next;
        setNavigationProject(next);
        setNavigationNotice("");
      } catch {
        setNavigationNotice(
          command.type === "frame_content"
            ? "World content is too large to fit in the supported zoom range."
            : "Navigation could not be applied.",
        );
      }
    },
    [projectId],
  );
  const frameNavigation = useCallback(() => {
    const currentProject = useOrb.getState().project;
    const viewportAspect =
      typeof window === "undefined"
        ? 1
        : window.innerWidth / Math.max(1, window.innerHeight);
    dispatchNavigation({
      type: "frame_content",
      committedEntityBounds: committedWorldNavigationBounds(currentProject),
      viewportAspect,
      verticalFovRadians: (43 * Math.PI) / 180,
    });
  }, [dispatchNavigation]);
  useEffect(() => {
    const previous = previousInitialFrameLifecycleRef.current;
    const current: InitialProjectFrameLifecycle = {
      projectId,
      phase,
      building,
      entityCount: project.entities.length,
    };
    if (pendingInitialFrameRef.current?.projectId !== projectId)
      pendingInitialFrameRef.current = null;
    if (isInitialProjectFrameBuildStart(previous, current))
      pendingInitialFrameRef.current = {
        projectId,
        userNavigated: false,
      };

    const pending = pendingInitialFrameRef.current;
    if (pending) {
      const hasRecovery = generationRecovery?.projectId === projectId;
      const canReadCommittedBounds =
        !building &&
        !playing &&
        !error &&
        !hasRecovery &&
        !pending.userNavigated &&
        phase !== "landing";
      const committedBounds = canReadCommittedBounds
        ? committedWorldNavigationBounds(project)
        : [];
      const settlement = initialProjectFrameSettlement(pending, {
        projectId,
        phase,
        building,
        playing,
        hasError: Boolean(error),
        hasRecovery,
        hasCommittedBounds: committedBounds.length > 0,
        userNavigated: pending.userNavigated,
      });
      if (settlement === "discard") pendingInitialFrameRef.current = null;
      else if (settlement === "frame") {
        pendingInitialFrameRef.current = null;
        const viewportAspect =
          typeof window === "undefined"
            ? 1
            : window.innerWidth / Math.max(1, window.innerHeight);
        dispatchNavigation(
          {
            type: "frame_content",
            committedEntityBounds: committedBounds,
            viewportAspect,
            verticalFovRadians: (43 * Math.PI) / 180,
          },
          false,
        );
      }
    }
    previousInitialFrameLifecycleRef.current = current;
  }, [
    building,
    dispatchNavigation,
    error,
    generationRecovery,
    phase,
    playing,
    project,
    projectId,
  ]);
  const notifyNavigationReady = useCallback(() => {
    setNavigationReady(true);
  }, []);
  const [failedAttempt, setFailedAttempt] = useState<number | null>(null);
  const [softwareFailedAttempt, setSoftwareFailedAttempt] = useState<
    number | null
  >(null);
  const [rendererProbe, setRendererProbe] = useState<{
    attempt: number;
    result: "pending" | "webgl" | "software";
  }>(() => ({ attempt: rendererRetryToken, result: "pending" }));
  const rendererProbeAttemptRef = useRef<number | null>(null);
  const attemptRef = useRef(rendererRetryToken);
  const failedAttemptRef = useRef<number | null>(null);
  const softwareFailedAttemptRef = useRef<number | null>(null);
  // A retry creates a new attempt. Late callbacks from the disposed Canvas
  // must not mark the new attempt ready or revive a failed one.
  attemptRef.current = rendererRetryToken;
  if (failedAttemptRef.current !== failedAttempt)
    failedAttemptRef.current = failedAttempt;
  const attempt = rendererRetryToken;
  const notifyPrimaryFailure = useCallback(
    (message: string) => {
      if (
        attemptRef.current !== attempt ||
        failedAttemptRef.current === attempt
      )
        return;
      failedAttemptRef.current = attempt;
      clearNavigationGestures();
      setNavigationReady(false);
      setFailedAttempt(attempt);
      onRendererFallback?.(message);
    },
    [attempt, clearNavigationGestures, onRendererFallback],
  );
  const notifyPrimaryFailureRef = useRef(notifyPrimaryFailure);
  notifyPrimaryFailureRef.current = notifyPrimaryFailure;
  const notifySoftwareFailure = (message: string) => {
    if (
      attemptRef.current !== attempt ||
      failedAttemptRef.current !== attempt ||
      softwareFailedAttemptRef.current === attempt
    )
      return;
    softwareFailedAttemptRef.current = attempt;
    setSoftwareFailedAttempt(attempt);
    onError?.(message);
  };
  const notifyRendererReady = (renderer: "webgl" | "software" = "webgl") => {
    if (
      attemptRef.current === attempt &&
      softwareFailedAttemptRef.current !== attempt &&
      (renderer === "software" || failedAttemptRef.current !== attempt)
    )
      onRendererReady?.(renderer);
  };
  const notifySceneReady = () => {
    if (
      attemptRef.current === attempt &&
      softwareFailedAttemptRef.current !== attempt
    )
      onReady?.();
  };
  useEffect(() => {
    if (rendererProbeAttemptRef.current === attempt) return;
    rendererProbeAttemptRef.current = attempt;
    const useSoftwareRenderer = hasAndroidEmulatorSwiftShaderRenderer();
    if (attemptRef.current !== attempt) return;
    setRendererProbe({
      attempt,
      result: useSoftwareRenderer ? "software" : "webgl",
    });
    if (useSoftwareRenderer)
      notifyPrimaryFailureRef.current(webglUnavailableMessage);
  }, [attempt]);
  const rendererProbePending =
    rendererProbe.attempt !== attempt || rendererProbe.result === "pending";
  // Canvas reapplies its DPR prop on parent renders. Keep it in sync with
  // adaptation so typing and scene revisions cannot restore full resolution.
  const [renderDpr, setRenderDpr] = useState(1);
  // Keep gameplay's scene input exclusive to the player controls.
  const navigationGesturesEnabled =
    navigationReady && phase === "editing" && !playing;
  let renderer: ReactNode;
  if (rendererProbePending) {
    renderer = <CanvasFallback />;
  } else if (failedAttempt === attempt) {
    if (softwareFailedAttempt === attempt)
      renderer = onError ? null : <Unavailable />;
    else
      renderer = (
        <Boundary key={`software-${attempt}`} onError={notifySoftwareFailure}>
          <SoftwareWorld
            navigation={navigation}
            getNavigation={getNavigation}
            navigationGestureController={navigationGestureController}
            navigationEnabled={navigationGesturesEnabled}
            onNavigationCommand={dispatchNavigation}
            onNavigationClickSuppression={markNavigationClickSuppressed}
            clearNavigationGestures={clearNavigationGestures}
            clearNavigationClickFallback={clearNavigationClickFallback}
            consumeNavigationClick={consumeNavigationClick}
            onReady={notifySceneReady}
            onRendererReady={() => notifyRendererReady("software")}
            onError={notifySoftwareFailure}
            onNavigationReady={notifyNavigationReady}
          />
        </Boundary>
      );
  } else {
    renderer = (
      <Boundary key={attempt} onError={notifyPrimaryFailure}>
        <Canvas
          key={attempt}
          shadows={{ type: THREE.PCFShadowMap }}
          dpr={renderDpr}
          camera={{ position: [0, 1.8, 10.4], fov: 43, near: 0.1, far: 250 }}
          gl={(defaults) => {
            try {
              return new THREE.WebGLRenderer({
                ...defaults,
                antialias: true,
                alpha: true,
                powerPreference: "high-performance",
              });
            } catch (error) {
              // R3F configures the renderer asynchronously, outside the
              // error boundary. Report renderer construction failure here.
              notifyPrimaryFailure(webglUnavailableMessage);
              throw error;
            }
          }}
          fallback={<CanvasFallback />}
          onCreated={() => notifyRendererReady("webgl")}
          onPointerMissed={(event) => {
            if (consumeNavigationClick(pointerIdFromEvent(event as Event)))
              return;
            if (!useOrb.getState().playing)
              useOrb.getState().set({ selected: undefined });
          }}
        >
          <AdaptiveResolution onChange={setRenderDpr} />
          <Scene
            navigation={navigation}
            onReady={notifySceneReady}
            onInputLatency={onInputLatency}
            onNavigationReady={notifyNavigationReady}
            onNavigationCommand={dispatchNavigation}
            onNavigationClickSuppression={markNavigationClickSuppressed}
            clearNavigationGestures={clearNavigationGestures}
            clearNavigationClickFallback={clearNavigationClickFallback}
            consumeNavigationClick={consumeNavigationClick}
            navigationGestureController={navigationGestureController}
            navigationEnabled={navigationGesturesEnabled}
            getNavigation={getNavigation}
          />
        </Canvas>
      </Boundary>
    );
  }
  return (
    <>
      {phase === "editing" && !playing && softwareFailedAttempt !== attempt && (
        <WorldNavigationControls
          state={navigation}
          notice={navigationNotice}
          enabled={navigationReady}
          onCommand={dispatchNavigation}
          onFrame={frameNavigation}
        />
      )}
      {renderer}
    </>
  );
}
