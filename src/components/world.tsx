"use client";
import {
  Canvas,
  useFrame,
  useThree,
  type ThreeEvent,
} from "@react-three/fiber";
import { ContactShadows, OrbitControls, Stars } from "@react-three/drei";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  Component,
  type ReactNode,
} from "react";
import * as THREE from "three";
import { useOrb } from "@/lib/store";
import {
  markExperience,
  markVisibleSeed,
  hasExperienceMilestone,
} from "@/lib/experience-metrics";
import { collectGameProgramEntityIds } from "@/lib/game-program";
import { formationParticles } from "@/lib/formation-particles";
import { registerPublicationThumbnail } from "@/lib/publication-thumbnail";
import type { Entity } from "@/lib/protocol";
import {
  GameSession,
  GAME_RULES_RESTART_NOTICE,
  type GameSessionInput,
} from "@/lib/game-session";
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
  createParcelTransition,
  globeOffsetY,
  globeScale,
  parcelFrame,
  patchBlend,
  planetSpinRate,
  stepParcelTransition,
  type ParcelFrame,
} from "@/lib/parcel-transition";
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
function Formation({
  entity,
  session,
}: {
  entity: Entity;
  session: GameSession;
}) {
  const mesh = useRef<THREE.Mesh>(null);
  const particles = useRef<THREE.Points>(null);
  const group = useRef<THREE.Group>(null);
  const previous = useRef<THREE.BufferGeometry>(undefined);
  const previousParticles = useRef<THREE.BufferGeometry>(undefined);
  const previousShape = useRef<THREE.BufferGeometry>(undefined);
  const progress = useRef({ value: 0 });
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
  const pendingAsset = !!assetRecipe && !asset?.geometry;
  useEffect(() => {
    if (asset?.error)
      useOrb.getState().set({ error: `${entity.label}: ${asset.error}` });
  }, [asset?.error, entity.label]);
  const geometry = useMemo(() => {
    const source = assetRecipe
      ? (asset?.geometry?.clone() ??
        previousShape.current?.clone() ??
        entityGeometry({ ...entity, geometry: undefined }))
      : entityGeometry(entity);
    if (assetRecipe?.tint && asset?.geometry) {
      const tint = new THREE.Color(assetRecipe.tint);
      const colors = source.getAttribute("color");
      for (let i = 0; i < colors.count; i++)
        colors.setXYZ(i, tint.r, tint.g, tint.b);
      colors.needsUpdate = true;
      const sampledColors = source.getAttribute("formationColor");
      if (sampledColors) {
        for (let i = 0; i < sampledColors.count; i++)
          sampledColors.setXYZ(i, tint.r, tint.g, tint.b);
        sampledColors.needsUpdate = true;
      }
    }
    if (!assetRecipe || asset?.geometry) {
      previousShape.current?.dispose();
      previousShape.current = source.clone();
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
    return source;
  }, [entity.geometry, entity.color, asset?.geometry]);
  const particleGeometry = useMemo(
    () => formationParticles(geometry),
    [geometry],
  );
  useLayoutEffect(() => {
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
      !sameIndex ||
      prior.getAttribute("position").count !==
        geometry.getAttribute("position").count;
    particleGeometry.userData.particleBridge = geometry.userData.particleBridge;
    const visible = previous.current
      ? captureFormationSnapshot(previous.current, progress.current.value)
      : undefined;
    addFormationSource(geometry, visible);
    previous.current = geometry;
    progress.current.value = 0;
    if (mesh.current) mesh.current.visible = !geometry.userData.particleBridge;
    if (particles.current)
      particles.current.visible = geometry.userData.particleBridge;
  }, [geometry, particleGeometry]);
  useEffect(() => () => particleGeometry.dispose(), [particleGeometry]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => previousShape.current?.dispose(), []);
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
    group.current.visible = effective !== null;
    if (!effective) return;
    const override = playing
      ? session.state?.entityOverrides[entity.id]
      : undefined;
    gameTintEnabled.current.value = override?.color ? 1 : 0;
    if (override?.color) gameTint.value.set(override.color);
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
}: {
  session: GameSession;
  onReady?: () => void;
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
  const keys = useRef(new Set<string>());
  const presses = useRef<GameSessionInput[]>([]);
  const direction = useMemo(() => new THREE.Vector3(), []);
  const up = useMemo(() => new THREE.Vector3(0, 1, 0), []);
  const playing = useOrb((s) => s.playing);
  const reset = useOrb((s) => s.reset);
  const projectId = useOrb((s) => s.project.id);
  useEffect(() => {
    if (!playing) {
      presses.current = [];
      keys.current.clear();
    }
  }, [playing]);
  useEffect(() => {
    state.current = { position: [0, 0.5, 5], velocityY: 0 };
    usableEntities.current.clear();
    presses.current = [];
  }, [reset, projectId]);
  useEffect(() => {
    const actionForKey = (key: string): GameSessionInput | undefined =>
      (
        ({
          w: "up",
          arrowup: "up",
          s: "down",
          arrowdown: "down",
          a: "left",
          arrowleft: "left",
          d: "right",
          arrowright: "right",
          " ": "jump",
        }) as Record<string, GameSessionInput>
      )[key];
    const changeKey = (key: string, down: boolean) => {
      const action = actionForKey(key);
      if (down) {
        if (
          action &&
          useOrb.getState().playing &&
          presses.current.length < 64 &&
          ![...keys.current].some((held) => actionForKey(held) === action)
        )
          presses.current.push(action);
        keys.current.add(key);
      } else keys.current.delete(key);
    };
    const key = (e: KeyboardEvent, down: boolean) => {
      if (
        isTextEntryTarget(e.target) ||
        ((e.target as Element)?.closest("button") &&
          [" ", "Enter"].includes(e.key))
      )
        return;
      if (
        ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(e.key)
      )
        e.preventDefault();
      changeKey(e.key.toLowerCase(), down);
    };
    const d = (e: KeyboardEvent) => key(e, true),
      u = (e: KeyboardEvent) => key(e, false);
    const blur = () => {
      keys.current.clear();
      presses.current = [];
    };
    const focus = (event: FocusEvent) => {
      if (isTextEntryTarget(event.target)) blur();
    };
    const touch = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (typeof detail?.key === "string")
        changeKey(detail.key, Boolean(detail.down));
    };
    window.addEventListener("keydown", d);
    window.addEventListener("keyup", u);
    window.addEventListener("blur", blur);
    window.addEventListener("focusin", focus);
    window.addEventListener("orbsie-input", touch);
    inputsReady.current = true;
    return () => {
      inputsReady.current = false;
      window.removeEventListener("keydown", d);
      window.removeEventListener("keyup", u);
      window.removeEventListener("blur", blur);
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
      presses.current = [];
      return;
    }
    const dt = Math.min(delta, 0.04),
      k = keys.current;
    direction.set(
      (k.has("d") || k.has("arrowright") ? 1 : 0) -
        (k.has("a") || k.has("arrowleft") ? 1 : 0),
      0,
      (k.has("s") || k.has("arrowdown") ? 1 : 0) -
        (k.has("w") || k.has("arrowup") ? 1 : 0),
    );
    const pressed = presses.current.splice(0, 64);
    for (const action of pressed) session.queueInput(action);
    session.advance(dt);
    const didReset = resetAvatar();
    direction.applyAxisAngle(up, 0.5);
    if (direction.length()) direction.normalize();
    const result = stepGameplay(
      state.current,
      {
        x: direction.x,
        z: direction.z,
        jump: k.has(" ") || pressed.includes("jump"),
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
function Scene({ onReady }: { onReady?: () => void }) {
  const session = useMemo(() => new GameSession(), []);
  const projectId = useOrb((s) => s.project.id);
  const phase = useOrb((s) => s.phase),
    entities = useOrb((s) => s.project.entities),
    environment = useOrb((s) => s.project.environment),
    playing = useOrb((s) => s.playing);
  const { camera, size, gl, scene } = useThree();
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
  const transition = useRef(createParcelTransition());
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
  const cameraLook = useMemo(() => new THREE.Vector3(), []);
  useEffect(() => {
    transition.current = createParcelTransition(phase === "landing" ? 0 : 1);
    spin.current = 0;
    progress.current = transition.current.progress;
    initialized.current = false;
  }, [projectId]);
  useFrame((_, dt) => {
    const target = phase === "landing" ? 0 : 1;
    transition.current = stepParcelTransition(
      transition.current,
      target,
      dt,
      reduced(),
    );
    progress.current = transition.current.progress;
    spin.current = transition.current.spin;
    const t = progress.current;
    if (phase === "landing" || t < 0.995 || !initialized.current) {
      const mobile = size.width < 700;
      cameraStart.set(0, 1.8, mobile ? 14.5 : 10.2);
      cameraEnd.set(13, mobile ? 17 : 15, mobile ? 22 : 20);
      camera.position.copy(cameraStart.lerp(cameraEnd, t));
      const look = cameraLook.set(
        size.width < 700 ? 0 : -2.7,
        THREE.MathUtils.lerp(0.35, 0, t),
        0,
      );
      look.x *= t;
      camera.lookAt(look);
      if (controls.current) controls.current.target.copy(look);
      initialized.current = t > 0.99;
    }
    if (island.current) {
      const blend = patchBlend(t);
      spinQuaternion.setFromAxisAngle(
        localNormal,
        frame.spinPhase + transition.current.spin,
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
          />
        ))}
        <Player session={session} onReady={onReady} />
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
        enabled={phase === "editing" && !playing && progress.current > 0.98}
        enablePan={false}
        minDistance={13}
        maxDistance={34}
        minPolarAngle={0.25}
        maxPolarAngle={Math.PI / 2.3}
        enableDamping
      />
    </>
  );
}
const webglUnavailableMessage =
  "Your world needs WebGL2. Try a browser with hardware acceleration enabled.";
function Unavailable() {
  // R3F mounts fallback inside the canvas even when WebGL works. This markup
  // must never report renderer availability as a side effect.
  return <div className="webgl-fallback">{webglUnavailableMessage}</div>;
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
          <strong>Your world needs WebGL2</strong>
          <p>
            Try a recent browser with hardware acceleration enabled. Your saved
            world is safe.
          </p>
        </div>
      )
    ) : (
      this.props.children
    );
  }
}
export default function World({
  onReady,
  onError,
}: { onReady?: () => void; onError?: (message: string) => void } = {}) {
  const [rendererFailed, setRendererFailed] = useState(false);
  // Canvas reapplies its DPR prop on parent renders. Keep it in sync with
  // adaptation so typing and scene revisions cannot restore full resolution.
  const [renderDpr, setRenderDpr] = useState(1);
  if (rendererFailed) return onError ? null : <Unavailable />;
  return (
    <Boundary onError={onError}>
      <Canvas
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
            // R3F configures the renderer asynchronously, outside React's
            // error boundary. Report the actual construction failure here.
            setRendererFailed(true);
            onError?.(webglUnavailableMessage);
            throw error;
          }
        }}
        fallback={<Unavailable />}
        onPointerMissed={() => {
          if (!useOrb.getState().playing)
            useOrb.getState().set({ selected: undefined });
        }}
      >
        <AdaptiveResolution onChange={setRenderDpr} />
        <Scene onReady={onReady} />
      </Canvas>
    </Boundary>
  );
}
