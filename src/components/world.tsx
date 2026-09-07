"use client";
import {
  Canvas,
  useFrame,
  useThree,
  type ThreeEvent,
} from "@react-three/fiber";
import { ContactShadows, OrbitControls } from "@react-three/drei";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  Component,
  type ReactNode,
} from "react";
import * as THREE from "three";
import { useOrb } from "@/lib/store";
import type { Entity } from "@/lib/protocol";
import {
  entityGeometry,
  addFormationSource,
  terrainValue,
} from "@/lib/geometry";
const reduced = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;
function Planet({ progress }: { progress: React.RefObject<number> }) {
  const group = useRef<THREE.Group>(null);
  const cloud = useRef<THREE.Group>(null);
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
      group.current.visible = p < 0.83;
      group.current.rotation.y += reduced() ? 0 : dt * 0.027 * (1 - p);
      const s = 1 + p * p * 6;
      group.current.scale.setScalar(s);
      group.current.position.y = -p * 3 * s;
    }
    if (cloud.current) cloud.current.rotation.y += dt * 0.012;
  });
  return (
    <group ref={group} rotation={[0.1, -0.35, -0.12]}>
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
function Formation({ entity }: { entity: Entity }) {
  const mesh = useRef<THREE.Mesh>(null);
  const group = useRef<THREE.Group>(null);
  const previous = useRef<Float32Array>(undefined);
  const progress = useRef({ value: 0 });
  const selected = useOrb((s) => s.selected === entity.id);
  const collected = useOrb((s) => s.score.includes(entity.id));
  const playing = useOrb((s) => s.playing);
  const [bloom, setBloom] = useState(false);
  const geometry = useMemo(() => {
    const g = addFormationSource(entityGeometry(entity), previous.current);
    previous.current = new Float32Array(g.attributes.position.array);
    progress.current.value = 0;
    return g;
  }, [entity.geometry, entity.color]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const material = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.76,
      metalness: 0.02,
    });
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uFormation = progress.current;
      shader.vertexShader =
        "attribute vec3 aFrom; uniform float uFormation;\n" +
        shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        "#include <begin_vertex>",
        "vec3 transformed=mix(aFrom,position,smoothstep(0.0,1.0,uFormation));",
      );
    };
    m.customProgramCacheKey = () => "orbsie-formation-v1";
    return m;
  }, []);
  useEffect(() => () => material.dispose(), [material]);
  useFrame(({ clock }, dt) => {
    progress.current.value = Math.min(
      1,
      progress.current.value + dt / (reduced() ? 0.02 : 0.9),
    );
    if (!group.current) return;
    const target = new THREE.Vector3(...entity.position);
    if (entity.behavior?.type === "move" && entity.stage === "ready") {
      const axis = entity.behavior.axis ?? "y";
      target[axis] +=
        Math.sin(clock.elapsedTime * (entity.behavior.speed ?? 1)) *
        (entity.behavior.amplitude ?? 0.5);
    }
    if (entity.geometry?.kind === "crystal")
      target.y += Math.sin(clock.elapsedTime * 2 + entity.position[0]) * 0.13;
    group.current.position.lerp(target, 1 - Math.exp(-dt * 12));
    const scale = new THREE.Vector3(...entity.scale).multiplyScalar(
      bloom ? 1.35 : 1,
    );
    group.current.scale.lerp(scale, 1 - Math.exp(-dt * 5));
    if (mesh.current && entity.geometry?.kind === "crystal")
      mesh.current.rotation.y += dt * 0.6;
    material.emissive.set(
      entity.stage !== "ready" ? "#9debd4" : selected ? "#497d6c" : "#000000",
    );
    material.emissiveIntensity =
      entity.stage !== "ready"
        ? 0.3 + Math.sin(clock.elapsedTime * 3) * 0.15
        : selected
          ? 0.18
          : 0;
  });
  const click = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    if (playing && entity.behavior?.type === "bloom") {
      setBloom(!bloom);
      return;
    }
    if (!playing) useOrb.getState().set({ selected: entity.id });
  };
  if (collected && entity.behavior?.type === "collect") return null;
  return (
    <group ref={group} position={entity.position} scale={entity.scale}>
      <mesh
        ref={mesh}
        geometry={geometry}
        material={material}
        onClick={click}
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
function Player() {
  const ref = useRef<THREE.Group>(null);
  const pos = useRef(new THREE.Vector3(0, 0.5, 5));
  const velocity = useRef(0);
  const keys = useRef(new Set<string>());
  const playing = useOrb((s) => s.playing);
  const reset = useOrb((s) => s.reset);
  useEffect(() => {
    pos.current.set(0, 0.5, 5);
    velocity.current = 0;
  }, [reset]);
  useEffect(() => {
    const key = (e: KeyboardEvent, down: boolean) => {
      if (
        (e.target as HTMLElement)?.closest(
          "input,textarea,button,select,[contenteditable]",
        )
      )
        return;
      if (
        ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(e.key)
      )
        e.preventDefault();
      if (down) keys.current.add(e.key.toLowerCase());
      else keys.current.delete(e.key.toLowerCase());
    };
    const d = (e: KeyboardEvent) => key(e, true),
      u = (e: KeyboardEvent) => key(e, false);
    const blur = () => keys.current.clear();
    const touch = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      detail.down
        ? keys.current.add(detail.key)
        : keys.current.delete(detail.key);
    };
    window.addEventListener("keydown", d);
    window.addEventListener("keyup", u);
    window.addEventListener("blur", blur);
    window.addEventListener("orbsie-input", touch);
    return () => {
      window.removeEventListener("keydown", d);
      window.removeEventListener("keyup", u);
      window.removeEventListener("blur", blur);
      window.removeEventListener("orbsie-input", touch);
    };
  }, []);
  useFrame(({ clock }, delta) => {
    if (!ref.current) return;
    ref.current.visible = playing;
    if (!playing) return;
    const dt = Math.min(delta, 0.04),
      k = keys.current;
    const direction = new THREE.Vector3(
      (k.has("d") || k.has("arrowright") ? 1 : 0) -
        (k.has("a") || k.has("arrowleft") ? 1 : 0),
      0,
      (k.has("s") || k.has("arrowdown") ? 1 : 0) -
        (k.has("w") || k.has("arrowup") ? 1 : 0),
    );
    direction.applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.5);
    if (direction.length()) direction.normalize();
    pos.current.addScaledVector(direction, dt * 4);
    const s = useOrb.getState();
    let floor = 0.42;
    for (const e of s.project.entities) {
      if (e.stage !== "ready" || e.geometry?.kind !== "platform") continue;
      const p = new THREE.Vector3(...e.position);
      if (e.behavior?.type === "move")
        p[e.behavior.axis ?? "y"] +=
          Math.sin(clock.elapsedTime * (e.behavior.speed ?? 1)) *
          (e.behavior.amplitude ?? 0.5);
      const top = p.y + 0.52 * e.scale[1] + 0.42;
      if (
        Math.abs(pos.current.x - p.x) < e.scale[0] * 0.55 &&
        Math.abs(pos.current.z - p.z) < e.scale[2] * 0.55 &&
        pos.current.y >= top - 0.22
      )
        floor = Math.max(floor, top);
    }
    if (k.has(" ") && pos.current.y <= floor + 0.04) velocity.current = 6;
    velocity.current -= dt * 15;
    pos.current.y += velocity.current * dt;
    if (pos.current.y < floor) {
      pos.current.y = floor;
      velocity.current = 0;
    }
    if (Math.hypot(pos.current.x, pos.current.z) > 8.4) {
      pos.current.x *= 0.985;
      pos.current.z *= 0.985;
    }
    for (const e of s.project.entities) {
      if (e.stage !== "ready") continue;
      const distance = Math.hypot(
        pos.current.x - e.position[0],
        pos.current.z - e.position[2],
      );
      if (e.behavior?.type === "collect" && distance < 0.85) s.collect(e.id);
      if (
        e.behavior?.type === "portal" &&
        distance < 1.2 &&
        s.score.length >=
          s.project.entities.filter((x) => x.behavior?.type === "collect")
            .length &&
        !s.won
      )
        s.set({ won: true });
    }
    ref.current.position.copy(pos.current);
    if (direction.length())
      ref.current.rotation.y = Math.atan2(direction.x, direction.z);
    ref.current.position.y += direction.length()
      ? Math.abs(Math.sin(clock.elapsedTime * 10)) * 0.045
      : 0;
  });
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
function Scene() {
  const phase = useOrb((s) => s.phase),
    entities = useOrb((s) => s.project.entities),
    environment = useOrb((s) => s.project.environment),
    playing = useOrb((s) => s.playing);
  const { camera, size } = useThree();
  const progress = useRef(0);
  const island = useRef<THREE.Group>(null);
  const initialized = useRef(false);
  const controls = useRef<React.ComponentRef<typeof OrbitControls>>(null);
  const pebbles = useMemo(
    () =>
      Array.from({ length: 45 }, (_, i) => ({
        x: Math.cos(i * 2.4) * (7.2 + (i % 3) * 0.3),
        z: Math.sin(i * 2.4) * (7.2 + (i % 3) * 0.3),
        s: 0.1 + (i % 4) * 0.08,
      })),
    [],
  );
  useFrame((_, dt) => {
    const target = phase === "landing" ? 0 : 1;
    progress.current = THREE.MathUtils.damp(
      progress.current,
      target,
      reduced() ? 100 : 1.05,
      dt,
    );
    const t = progress.current;
    if (phase === "landing" || t < 0.995 || !initialized.current) {
      const landing =
        size.width < 700
          ? new THREE.Vector3(0, 2.2, 16.5)
          : new THREE.Vector3(0, 1.8, 14.4);
      const end =
        size.width < 700
          ? new THREE.Vector3(13, 17, 22)
          : new THREE.Vector3(13, 15, 20);
      camera.position.copy(landing.lerp(end, t));
      const look = new THREE.Vector3(
        size.width < 700 ? 0 : -2.7,
        THREE.MathUtils.lerp(0.65, 0, t),
        0,
      );
      look.x *= t;
      camera.lookAt(look);
      if (controls.current) controls.current.target.copy(look);
      initialized.current = t > 0.99;
    }
    if (island.current) {
      island.current.visible = t > 0.35;
      island.current.scale.setScalar(
        Math.max(0.001, THREE.MathUtils.smoothstep(t, 0.35, 0.87)),
      );
      island.current.position.y = -2 * (1 - t);
    }
  });
  return (
    <>
      <ambientLight intensity={1.6} />
      <hemisphereLight args={["#fff9de", "#a3c8be", 1.5]} />
      <directionalLight
        position={[-8, 14, 7]}
        intensity={2.5}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-12}
        shadow-camera-right={12}
        shadow-camera-top={12}
        shadow-camera-bottom={-12}
        shadow-normalBias={0.05}
      />
      <Planet progress={progress} />
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
        {pebbles.map((p, i) => (
          <mesh
            key={i}
            position={[p.x, 0.02, p.z]}
            scale={[p.s, p.s * 0.5, p.s]}
          >
            <sphereGeometry args={[1, 6, 4]} />
            <meshStandardMaterial color={i % 3 ? "#d8d7b0" : "#cad7a6"} />
          </mesh>
        ))}
        {entities.map((e) => (
          <Formation key={e.id} entity={e} />
        ))}
        <Player />
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
class Boundary extends Component<{ children: ReactNode }, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  render() {
    return this.state.error ? (
      <div className="webgl-fallback">
        <strong>Your world needs WebGL2</strong>
        <p>
          Try a recent browser with hardware acceleration enabled. Your saved
          world is safe.
        </p>
      </div>
    ) : (
      this.props.children
    );
  }
}
export default function World() {
  return (
    <Boundary>
      <Canvas
        shadows={{ type: THREE.PCFShadowMap }}
        dpr={[1, 1.5]}
        camera={{ position: [0, 1.8, 10.4], fov: 43, near: 0.1, far: 250 }}
        gl={{
          antialias: true,
          alpha: true,
          powerPreference: "high-performance",
        }}
        fallback={
          <div className="webgl-fallback">
            Your browser needs WebGL2 to open a 3D world.
          </div>
        }
        onPointerMissed={() => {
          if (!useOrb.getState().playing)
            useOrb.getState().set({ selected: undefined });
        }}
      >
        <Scene />
      </Canvas>
    </Boundary>
  );
}
