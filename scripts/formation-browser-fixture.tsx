import {
  beginExperience,
  noteReservation,
  getExperienceMetrics,
} from "../src/lib/experience-metrics";
import * as THREE from "three";
import {
  formationParticles,
  prepareFormationParticles,
} from "../src/lib/formation-particles";
/** Test-only renderer fixture; never imported by the app or standalone player. */
import { capturePublicationThumbnail } from "../src/lib/publication-thumbnail";
import { createRoot } from "react-dom/client";
import { _roots } from "@react-three/fiber";
import World from "../src/components/world";
import { useOrb } from "../src/lib/store";
import { blankProject, type Entity } from "../src/lib/protocol";

const entities: Entity[] = ["tree", "platform", "arch"].map((kind, index) => ({
  id: kind,
  label: kind,
  position: [(index - 1) * 3, 0, 0],
  scale: [1, 1, 1],
  color: "#42b894",
  stage: "ready",
  behavior: { type: "static" },
  geometry: { kind, detail: "coarse" } as Entity["geometry"],
}));
const fixtureProject = { ...blankProject(), entities };
useOrb.getState().load(fixtureProject);
const experienceToken = beginExperience(fixtureProject.id);
for (const entity of entities)
  noteReservation(fixtureProject.id, entity.id, experienceToken);
createRoot(document.getElementById("root")!).render(<World />);

const state = () =>
  _roots.get(document.querySelector("canvas")!)!.store.getState();
const meshes = () => {
  const result: any[] = [];
  state().scene.traverse((object: any) => {
    if (
      object.isMesh &&
      object.material?.customProgramCacheKey?.() === "orbsie-formation-v3"
    )
      result.push(object);
  });
  return result.sort((a, b) => a.parent.position.x - b.parent.position.x);
};
const pointMeshes = () => {
  const result: any[] = [];
  state().scene.traverse((object: any) => {
    if (
      object.isPoints &&
      object.material?.customProgramCacheKey?.() ===
        "orbsie-formation-particles-v1"
    )
      result.push(object);
  });
  return result.sort((a, b) => a.parent.position.x - b.parent.position.x);
};
const progress = (mesh: any) => {
  const shader = {
    uniforms: {},
    vertexShader: "#include <color_vertex>\n#include <begin_vertex>",
    fragmentShader: "#include <color_fragment>",
  } as any;
  mesh.material.onBeforeCompile(shader, state().gl);
  if (!shader.vertexShader.includes("mix(aFromColor, color.rgb"))
    throw Error("Authored color interpolation shader missing");
  return shader.uniforms.uFormation;
};
const samples = (mesh: any, amount: number) => {
  const geometry = mesh.geometry;
  const eased = amount * amount * (3 - 2 * amount);
  return ["position", "color"].map((name) => {
    const to = geometry.getAttribute(name);
    const from = geometry.getAttribute(
      name === "position" ? "aFrom" : "aFromColor",
    );
    return Array.from(
      { length: to.count * 3 },
      (_, index) =>
        from.array[index] + (to.array[index] - from.array[index]) * eased,
    );
  });
};
const render = () => {
  // The fixture freezes the frame loop; apply the renderer's visibility phase
  // explicitly while inspecting exact interpolation values.
  for (const mesh of meshes())
    mesh.visible =
      !mesh.geometry.userData.particleBridge || progress(mesh).value >= 1;
  state().scene.traverse((object: any) => {
    if (
      object.isPoints &&
      object.material?.customProgramCacheKey?.() ===
        "orbsie-formation-particles-v1"
    ) {
      const shader = {
        uniforms: {},
        vertexShader: "#include <color_vertex>\n#include <begin_vertex>",
        fragmentShader: "#include <color_fragment>",
      } as any;
      object.material.onBeforeCompile(shader, state().gl);
      object.visible =
        !!object.geometry.userData.particleBridge &&
        shader.uniforms.uFormation.value < 1;
    }
  });
  state().gl.render(state().scene, state().camera);
};
let expected: number[][][];
let expectedParticles: number[][][];
let oldGeometries: unknown[];
(window as any).formationFixture = {
  thumbnail: capturePublicationThumbnail,
  async metrics() {
    useOrb.setState({ playing: true });
    const started = performance.now();
    while (
      getExperienceMetrics(fixtureProject.id)[0].milestones.controls === null
    ) {
      if (performance.now() - started > 2000)
        throw Error("Usable controls milestone missing");
      await new Promise(requestAnimationFrame);
    }
    const snapshot = getExperienceMetrics(fixtureProject.id)[0];
    useOrb.setState({ playing: false });
    return { milestones: snapshot.milestones, outcome: snapshot.outcome };
  },
  benchmark() {
    const dense = new THREE.SphereGeometry(1, 256, 128);
    const cases = [
      ...meshes().map((mesh, index) => ({
        name: entities[index].id,
        geometry: mesh.geometry,
      })),
      { name: "dense-indexed-sphere", geometry: dense },
    ];
    const results = cases.map(({ name, geometry }) => {
      const times = [];
      for (let repeat = 0; repeat < 5; repeat++) {
        const started = performance.now();
        const points = formationParticles(geometry);
        times.push(performance.now() - started);
        points.dispose();
      }
      return {
        name,
        vertices: geometry.getAttribute("position").count,
        triangles:
          (geometry.index?.count ?? geometry.getAttribute("position").count) /
          3,
        samples: 2048,
        milliseconds: times,
      };
    });
    prepareFormationParticles(dense);
    const preparedTimes = [];
    for (let repeat = 0; repeat < 5; repeat++) {
      const started = performance.now();
      const points = formationParticles(dense);
      preparedTimes.push(performance.now() - started);
      points.dispose();
    }
    results.push({
      name: "dense-prepared-reuse",
      vertices: dense.getAttribute("position").count,
      triangles: dense.index!.count / 3,
      samples: 2048,
      milliseconds: preparedTimes,
    });
    dense.dispose();
    return {
      renderer: (() => {
        const context = state().gl.getContext();
        const extension = context.getExtension("WEBGL_debug_renderer_info");
        return extension
          ? context.getParameter(extension.UNMASKED_RENDERER_WEBGL)
          : "unknown";
      })(),
      userAgent: navigator.userAgent,
      hardwareConcurrency: navigator.hardwareConcurrency,
      results,
    };
  },
  ready: () =>
    !!_roots.get(document.querySelector("canvas")!)?.store &&
    meshes().length === 3 &&
    meshes().every((mesh) => mesh.geometry.getAttribute("aFromColor")),
  begin() {
    state().setFrameloop("never");
    for (const mesh of meshes()) progress(mesh).value = 0.4;
    expected = meshes().map((mesh) => samples(mesh, 0.4));
    expectedParticles = pointMeshes().map((mesh) => samples(mesh, 0.4));
    oldGeometries = meshes().map((mesh) => mesh.geometry);
    render();
    const project = useOrb.getState().project;
    useOrb.setState({
      project: {
        ...project,
        revision: project.revision + 1,
        entities: project.entities.map((entity) => ({
          ...entity,
          color: "#ff44aa",
          geometry: { ...entity.geometry!, detail: "refined", tint: "#ff44aa" },
        })),
      },
    });
  },
  updated: () =>
    meshes().every((mesh, index) => mesh.geometry !== oldGeometries[index]),
  verify() {
    const result = meshes().map((mesh, entityIndex) => {
      if (progress(mesh).value !== 0)
        throw Error("New morph did not begin at zero");
      let maxPositionError = 0,
        maxColorError = 0;
      for (const [attributeIndex, name] of ["aFrom", "aFromColor"].entries()) {
        const actual = mesh.geometry.getAttribute(name).array;
        const prior = expected[entityIndex][attributeIndex];
        for (let index = 0; index < actual.length; index++) {
          const delta = Math.abs(actual[index] - prior[index % prior.length]);
          if (attributeIndex === 0)
            maxPositionError = Math.max(maxPositionError, delta);
          else maxColorError = Math.max(maxColorError, delta);
        }
      }
      if (maxPositionError > 0.00001 || maxColorError > 0.00001)
        throw Error("Morph restarted from an endpoint");
      const points = pointMeshes()[entityIndex];
      let maxParticleError = 0;
      for (const [attributeIndex, name] of ["aFrom", "aFromColor"].entries()) {
        const actual = points.geometry.getAttribute(name).array;
        const prior = expectedParticles[entityIndex][attributeIndex];
        for (let index = 0; index < actual.length; index++)
          maxParticleError = Math.max(
            maxParticleError,
            Math.abs(actual[index] - prior[index % prior.length]),
          );
      }
      if (maxParticleError > 0.00001)
        throw Error("Surface particles lost visible continuity");
      return {
        particleCount: points.geometry.getAttribute("position").count,
        maxParticleError,
        family: entities[entityIndex].id,
        particleBridge: !!mesh.geometry.userData.particleBridge,
        maxPositionError,
        maxColorError,
      };
    });
    render();
    return result;
  },
  async realtime(tint?: string) {
    const prior = meshes().map((mesh) => mesh.geometry);
    const project = useOrb.getState().project;
    useOrb.setState({
      project: {
        ...project,
        revision: project.revision + 1,
        entities: project.entities.map((entity) => ({
          ...entity,
          ...(tint ? { color: tint } : {}),
          geometry: {
            ...entity.geometry!,
            detail: "coarse",
            ...(tint ? { tint } : {}),
          },
        })),
      },
    });
    state().setFrameloop("always");
    const samples: {
      time: number;
      bridges: number;
      particles: number;
      solids: number;
      complete: boolean;
    }[] = [];
    const started = performance.now();
    await new Promise<void>((resolve, reject) => {
      const observe = () => {
        if (performance.now() - started > 5000)
          return reject(Error("Real-time formation did not settle"));
        const current = meshes();
        if (current.every((mesh, index) => mesh.geometry !== prior[index])) {
          let particles = 0;
          state().scene.traverse((object: any) => {
            if (
              object.isPoints &&
              object.material?.customProgramCacheKey?.() ===
                "orbsie-formation-particles-v1" &&
              object.visible
            )
              particles++;
          });
          const complete = current.every((mesh) => progress(mesh).value === 1);
          samples.push({
            time: performance.now() - started,
            bridges: current.filter(
              (mesh) => mesh.geometry.userData.particleBridge,
            ).length,
            particles,
            solids: current.filter((mesh) => mesh.visible).length,
            complete,
          });
          if (complete) return resolve();
        }
        requestAnimationFrame(observe);
      };
      requestAnimationFrame(observe);
    });
    return samples;
  },
  frame(value: number) {
    for (const mesh of meshes()) progress(mesh).value = value;
    render();
  },
};
