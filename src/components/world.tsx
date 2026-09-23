"use client";
import {
  Canvas,
  useFrame,
  useThree,
  type ThreeEvent,
} from "@react-three/fiber";
import { ContactShadows, OrbitControls, Stars } from "@react-three/drei";
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
import type { Entity } from "@/lib/protocol";
import { GameSession, GAME_RULES_RESTART_NOTICE } from "@/lib/game-session";
import {
  PlayerInputTracker,
  actionForPlayerKey,
  type PlayerInputDetail,
  type PlayerInputLatencySnapshot,
} from "@/lib/player-input";
import {
  useAssetGeometry,
  isAssetGeometryReady,
} from "@/lib/use-asset-geometry";
import {
  useGeneratedGeometry,
  isGeneratedGeometryReady,
} from "@/lib/use-generated-geometry";
import { isAssetId } from "@/lib/asset-catalog";
import { maximumRenderDpr, RenderBudget } from "@/lib/render-budget";
import {
  createWorldNavigationState,
  applyWorldNavigationCommand,
  worldNavigationCameraPose,
  worldNavigationFarPlane,
  worldNavigationLandingLookTarget,
  worldNavigationProjectState,
  WORLD_NAVIGATION_LIMITS,
  type WorldNavigationProjectState,
  type WorldNavigationCommand,
  WORLD_NAVIGATION_DEFAULT_DISTANCE,
} from "@/lib/world-navigation";
import { committedWorldNavigationBounds } from "@/lib/world-navigation-bounds";
import {
  entityGeometry,
  addFormationSource,
  captureFormationSnapshot,
  terrainValue,
} from "@/lib/geometry";
import {
  isTextEntryTarget,
  movingEntityPosition,
  registerContactBounds,
  stepGameplay,
  type PlayerState,
} from "@/lib/gameplay";
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
const reduced = () => {
  if (typeof window === "undefined") return false;
  motionPreference ??= window.matchMedia("(prefers-reduced-motion: reduce)");
  return motionPreference.matches;
};
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
  disposed: boolean;
}

const EMPTY_FORMATION_RESOURCE: FormationResource = {
  appearance: { geometry: EMPTY_FORMATION_GEOMETRY },
  particleGeometry: EMPTY_FORMATION_PARTICLES,
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
  session,
  revision,
  onReviewState,
}: {
  entity: Entity;
  session: GameSession;
  revision: number;
  onReviewState?: (id: string, state: FormationReviewState | undefined) => void;
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
  const gameTint = useMemo(() => ({ value: new THREE.Color() }), []);
  const gameTintEnabled = useRef({ value: 0 });
  const target = useMemo(() => new THREE.Vector3(), []);
  const targetScale = useMemo(() => new THREE.Vector3(), []);
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
  useEffect(() => {
    if (asset?.error)
      useOrb.getState().set({ error: `${entity.label}: ${asset.error}` });
  }, [asset?.error, entity.label]);
  const [resource, setResource] = useState<FormationResource>(
    () => EMPTY_FORMATION_RESOURCE,
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
  }, [resource]);
  useLayoutEffect(() => {
    if (!commitsAppearance || geometry === EMPTY_FORMATION_GEOMETRY) return;
    const retained: FormationAppearance = {
      geometry: geometry.clone(),
      texture: texture ? cloneFormationTexture(texture) : undefined,
      release: texture ? retainAssetAppearance?.() : undefined,
    };
    const prior = previousAppearance.current;
    previousAppearance.current = retained;
    disposeFormationAppearance(prior);
  }, [commitsAppearance, geometry, texture, retainAssetAppearance]);
  useLayoutEffect(() => {
    if (resource === EMPTY_FORMATION_RESOURCE || !commitsAppearance) return;
    renderedRevision.current = revision;
    notifySceneReviewCaptureChanged();
  }, [commitsAppearance, resource, revision]);
  useLayoutEffect(() => {
    const state: FormationReviewState = () => {
      const failed = typeof asset?.error === "string" && asset.error.length > 0;
      const pending =
        !failed &&
        (resource === EMPTY_FORMATION_RESOURCE ||
          !commitsAppearance ||
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
    geometry.userData.particleBridge =
      !prior ||
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
    progress.current.value = 0;
    if (mesh.current) mesh.current.visible = !geometry.userData.particleBridge;
    if (particles.current)
      particles.current.visible = geometry.userData.particleBridge;
  }, [geometry, particleGeometry]);
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
    const visibilityProbe = (
      globalThis as typeof globalThis & {
        __orbsieFormationVisibilityProbe?: Record<string, boolean>;
      }
    ).__orbsieFormationVisibilityProbe;
    if (visibilityProbe)
      visibilityProbe[entity.id] = mesh.current?.visible === true;
    if (!group.current) return;
    const effective = playing ? session.effectiveEntity(entity) : entity;
    group.current.visible = effective !== null;
    if (!effective) return;
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
  });
  const click = (event: ThreeEvent<MouseEvent>) => {
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
    <group ref={group} position={entity.position} scale={entity.scale}>
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
          if (mesh.current && (!playing || session.effectiveEntity(entity)))
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
function Player({
  session,
  onReady,
  onInputLatency,
}: {
  session: GameSession;
  onReady?: () => void;
  onInputLatency?: (snapshot: PlayerInputLatencySnapshot) => void;
}) {
  const inputsReady = useRef(false);
  const announcedReady = useRef(false);
  const generation = useRef(-1);
  const usableEntities = useRef(new Map<string, Entity>());
  const ref = useRef<THREE.Group>(null);
  const state = useRef<PlayerState>({
    position: [0, 0.5, 5],
    velocityY: 0,
  });
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
  useEffect(() => {
    if (!playing) {
      inputs.current.clear();
    }
  }, [playing]);
  useEffect(() => {
    state.current = { position: [0, 0.5, 5], velocityY: 0 };
    usableEntities.current.clear();
    inputs.current.clear();
  }, [reset, projectId]);
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
      state.current = { position: [0, 0.5, 5], velocityY: 0 };
      s.set({ score: [], gameScore: 0, won: false, lost: false });
      return true;
    };
    resetAvatar();
    const currentIds = new Set(s.project.entities.map((entity) => entity.id));
    for (const id of usableEntities.current.keys())
      if (!currentIds.has(id)) usableEntities.current.delete(id);
    for (const entity of s.project.entities)
      if (
        entity.geometry?.kind === "generated"
          ? !!entity.geometry.model &&
            isGeneratedGeometryReady(entity.geometry.model.sha256)
          : entity.geometry?.kind !== "asset" ||
            isAssetGeometryReady(entity.geometry.assetId)
      )
        usableEntities.current.set(entity.id, entity);
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
        .map((entity) => {
          if (
            (entity.geometry?.kind === "asset" &&
              !isAssetGeometryReady(entity.geometry.assetId)) ||
            (entity.geometry?.kind === "generated" &&
              (!entity.geometry.model ||
                !isGeneratedGeometryReady(entity.geometry.model.sha256)))
          )
            return usableEntities.current.has(entity.id)
              ? {
                  ...entity,
                  geometry: usableEntities.current.get(entity.id)!.geometry,
                  stage: usableEntities.current.get(entity.id)!.stage,
                }
              : { ...entity, stage: "seed" as const };
          usableEntities.current.set(entity.id, entity);
          return entity;
        })
        .map((entity) => session.effectiveEntity(entity))
        .filter((entity): entity is Entity => entity !== null),
      didReset ? [] : useOrb.getState().score,
      clock.elapsedTime,
      session.state && session.state.status !== "playing" ? 0 : dt,
      session.collisionTargets,
      worldMatrices,
    );
    state.current = result;
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
          objectiveIds.every(
            (id) => usableEntities.current.get(id)?.stage === "ready",
          )
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
function Scene({
  onReady,
  onInputLatency,
  onNavigationReady,
  navigation,
}: {
  onReady?: () => void;
  onInputLatency?: (snapshot: PlayerInputLatencySnapshot) => void;
  onNavigationReady?: () => void;
  navigation: WorldNavigationProjectState["navigation"];
}) {
  const session = useMemo(() => new GameSession(), []);
  const projectId = useOrb((s) => s.project.id);
  const phase = useOrb((s) => s.phase),
    revision = useOrb((s) => s.project.revision),
    entities = useOrb((s) => s.project.entities),
    environment = useOrb((s) => s.project.environment),
    playing = useOrb((s) => s.playing);
  const { camera, size, gl, scene } = useThree();
  const reviewEntitiesRef = useRef(entities);
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
  const initialized = useRef(false);
  const controls = useRef<React.ComponentRef<typeof OrbitControls>>(null);
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
    navigationReadyNotified.current = false;
    notifySceneReviewCaptureChanged();
  }, [phase, projectId]);
  useEffect(() => parcelTransitionController.attachRenderer(), []);
  useFrame((_, dt) => {
    const target = phase === "landing" ? 0 : 1;
    parcelTransitionController.setTarget(target);
    const snapshot = parcelTransitionController.step(dt, reduced());
    const transitionSettled = phase === "editing" && snapshot.settled;
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
      if (controls.current) controls.current.target.set(...look);
      initialized.current = t > 0.99;
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
      const pose = worldNavigationCameraPose(navigation);
      camera.position.set(...pose.position);
      camera.lookAt(...pose.target);
      const perspectiveCamera = camera as THREE.PerspectiveCamera;
      const far = worldNavigationFarPlane(navigation);
      if (perspectiveCamera.far !== far) {
        perspectiveCamera.far = far;
        perspectiveCamera.updateProjectionMatrix();
      }
      if (controls.current) controls.current.target.set(...pose.target);
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
  });
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
        position={[-8, 14, 7]}
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
      <group ref={island} visible={false}>
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
        {entities.map((e) => (
          <Formation
            key={`${projectId}/${e.id}`}
            entity={e}
            session={session}
            revision={revision}
            onReviewState={setFormationReviewState}
          />
        ))}
        <Player
          session={session}
          onReady={onReady}
          onInputLatency={onInputLatency}
        />
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
      <OrbitControls
        ref={controls}
        enabled={false}
        enablePan={false}
        minDistance={WORLD_NAVIGATION_LIMITS.minDistance}
        maxDistance={WORLD_NAVIGATION_LIMITS.maxDistance}
        minPolarAngle={0.25}
        maxPolarAngle={Math.PI / 2.3}
        enableDamping
      />
    </>
  );
}
const webglUnavailableMessage =
  "Your world needs WebGL2, but WebGL2 could not initialize in this browser.";
function CanvasFallback() {
  // R3F mounts this fallback as a child of <canvas>, including during a
  // healthy WebGL render. Keep its transient copy out of the accessibility
  // tree; real renderer failures use Unavailable or GraphicsGuidance below.
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
  const [navigationProject, setNavigationProject] = useState(() =>
    worldNavigationProjectState(projectId),
  );
  const navigationProjectRef = useRef(navigationProject);
  navigationProjectRef.current = navigationProject;
  const navigation =
    navigationProject.projectId === projectId
      ? navigationProject.navigation
      : createWorldNavigationState();
  const [navigationNotice, setNavigationNotice] = useState("");
  const [navigationReady, setNavigationReady] = useState(false);
  useLayoutEffect(() => {
    if (
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
  }, [phase, projectId]);
  const dispatchNavigation = useCallback(
    (command: WorldNavigationCommand) => {
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
  const notifyNavigationReady = useCallback(() => {
    setNavigationReady(true);
  }, []);
  const [failedAttempt, setFailedAttempt] = useState<number | null>(null);
  const [softwareFailedAttempt, setSoftwareFailedAttempt] = useState<
    number | null
  >(null);
  const attemptRef = useRef(rendererRetryToken);
  const failedAttemptRef = useRef<number | null>(null);
  const softwareFailedAttemptRef = useRef<number | null>(null);
  // A retry creates a new attempt. Late callbacks from the disposed Canvas
  // must not mark the new attempt ready or revive a failed one.
  attemptRef.current = rendererRetryToken;
  if (failedAttemptRef.current !== failedAttempt)
    failedAttemptRef.current = failedAttempt;
  const attempt = rendererRetryToken;
  const notifyPrimaryFailure = (message: string) => {
    if (attemptRef.current !== attempt || failedAttemptRef.current === attempt)
      return;
    failedAttemptRef.current = attempt;
    setNavigationReady(false);
    setFailedAttempt(attempt);
    onRendererFallback?.(message);
  };
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
  // Canvas reapplies its DPR prop on parent renders. Keep it in sync with
  // adaptation so typing and scene revisions cannot restore full resolution.
  const [renderDpr, setRenderDpr] = useState(1);
  let renderer: ReactNode;
  if (failedAttempt === attempt) {
    if (softwareFailedAttempt === attempt)
      renderer = onError ? null : <Unavailable />;
    else
      renderer = (
        <Boundary key={`software-${attempt}`} onError={notifySoftwareFailure}>
          <SoftwareWorld
            navigation={navigation}
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
              // error boundary. Report construction failure here.
              notifyPrimaryFailure(webglUnavailableMessage);
              throw error;
            }
          }}
          fallback={<CanvasFallback />}
          onCreated={() => notifyRendererReady("webgl")}
          onPointerMissed={() => {
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
          />
        </Canvas>
      </Boundary>
    );
  }
  return (
    <>
      {phase === "editing" && softwareFailedAttempt !== attempt && (
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
