#!/usr/bin/env node

/**
 * Probe the optional local Blender companion boundary.
 *
 * This deliberately runs a trusted, repository-owned Blender program. It does
 * not accept Python or Blender code from a model, a file, or stdin. The probe
 * is a capability check for the future companion protocol, not a modeling
 * service.
 */

import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { performance } from "node:perf_hooks";

const BLENDER = "/usr/bin/blender";
const BWRAP = process.env.ORBSIE_BWRAP_PATH || "/usr/bin/bwrap";
const JOB_TIMEOUT_SECONDS = 30;
const CPU_LIMIT_SECONDS = 20;
// Blender 4.0.2 maps enough runtime state that a 1 GiB address-space limit
// crashes during startup even for this tiny job; 2 GiB is the smallest tested
// limit that starts reliably in this Debian package.
const MEMORY_LIMIT_BYTES = 2_048 * 1_024 * 1_024;
const OUTPUT_LIMIT_BYTES = 64 * 1_024 * 1_024;
// RLIMIT_NPROC is per-UID on Linux, so leave headroom for the user's existing
// processes while still bounding runaway jobs. The isolated namespace remains
// the primary process boundary.
const PROCESS_LIMIT = 4096;

const TRUSTED_JOB = String.raw`
import bpy
import json
import os
from mathutils import Vector


def make_material(name, color, metallic=0.0, roughness=0.5):
    material = bpy.data.materials.new(name)
    material.diffuse_color = (*color, 1.0)
    material.use_nodes = True
    principled = material.node_tree.nodes.get("Principled BSDF")
    principled.inputs["Base Color"].default_value = (*color, 1.0)
    principled.inputs["Metallic"].default_value = metallic
    principled.inputs["Roughness"].default_value = roughness
    return material


bpy.ops.wm.read_factory_settings(use_empty=True)

blue = make_material("Probe Blue", (0.06, 0.38, 0.95), metallic=0.1, roughness=0.32)
gold = make_material("Probe Gold", (0.95, 0.48, 0.06), metallic=0.35, roughness=0.28)

bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=1.0, location=(0.0, 0.0, 1.0))
sphere = bpy.context.object
sphere.name = "probe_seed_orb"
sphere.data.materials.append(blue)
sphere["orbsie_entity_id"] = "probe-orb-1"
sphere["orbsie_semantic"] = "organic orb"

bpy.ops.mesh.primitive_cube_add(size=2.0, location=(0.0, 0.0, -0.25))
platform = bpy.context.object
platform.name = "probe_platform"
platform.scale = (1.8, 1.8, 0.25)
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
platform.data.materials.append(gold)
platform["orbsie_entity_id"] = "probe-platform-1"
platform["orbsie_semantic"] = "hard surface platform"

for obj in (sphere, platform):
    obj.select_set(True)
bpy.context.view_layer.objects.active = sphere

output_path = os.path.abspath("/work/probe.glb")
bpy.ops.export_scene.gltf(
    filepath=output_path,
    export_format="GLB",
    export_materials="EXPORT",
    use_selection=True,
)

def bounds_for_object(obj):
    corners = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
    return {
        "min": [min(point[index] for point in corners) for index in range(3)],
        "max": [max(point[index] for point in corners) for index in range(3)],
    }


meshes = []
for obj in (sphere, platform):
    mesh = obj.data
    meshes.append({
        "entityId": obj.get("orbsie_entity_id"),
        "semantic": obj.get("orbsie_semantic"),
        "vertices": len(mesh.vertices),
        "triangles": sum(len(poly.vertices) - 2 for poly in mesh.polygons),
        "materials": [material.name for material in mesh.materials if material],
        "bounds": bounds_for_object(obj),
    })

with open("/work/result.json", "w", encoding="utf-8") as handle:
    json.dump({
        "blenderVersion": bpy.app.version_string,
        "output": output_path,
        "objects": meshes,
        "trustedJob": "procedural-mesh-to-glb",
    }, handle, indent=2, sort_keys=True)
`;

function parseArgs(argv) {
  const options = { keepWorkdir: false, output: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--keep-workdir") {
      options.keepWorkdir = true;
    } else if (arg === "--output") {
      const value = argv[index + 1];
      if (!value) throw new Error("--output requires a path");
      options.output = resolve(value);
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: node scripts/blender-probe.mjs [--output PATH] [--keep-workdir]",
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function commandVersion(binary, args) {
  try {
    return execFileSync(binary, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    const detail = error?.stderr?.toString()?.trim() || error.message;
    throw new Error(`${binary} is unavailable: ${detail}`);
  }
}

function buildBubblewrapArgs(workdir, numpyPath) {
  // /usr and the dynamic-loader directories contain the Blender runtime and
  // its system libraries. The host home is reconstructed with only the exact
  // NumPy package needed by this Debian exporter; the project tree and
  // credentials are intentionally absent. /etc is reconstructed with only
  // non-secret files needed for dynamic loading and basic process identity.
  const numpySite = dirname(numpyPath);
  const numpyLibs = join(numpySite, "numpy.libs");
  const homeRoot = process.env.HOME || dirname(dirname(dirname(numpySite)));
  const homeRelative = relative("/home", homeRoot);
  if (homeRelative.startsWith("..") || homeRelative.includes("/")) {
    throw new Error(
      `numpy path must be under /home for the isolated probe: ${numpyPath}`,
    );
  }

  const args = [
    "--die-with-parent",
    "--new-session",
    "--unshare-all",
    "--clearenv",
    "--ro-bind",
    "/usr",
    "/usr",
    "--ro-bind",
    "/bin",
    "/bin",
    "--ro-bind",
    "/lib",
    "/lib",
    "--ro-bind",
    "/lib64",
    "/lib64",
    "--dir",
    "/etc",
    "--ro-bind",
    "/etc/ld.so.cache",
    "/etc/ld.so.cache",
    "--ro-bind",
    "/etc/alternatives",
    "/etc/alternatives",
    "--ro-bind",
    "/etc/passwd",
    "/etc/passwd",
    "--ro-bind",
    "/etc/group",
    "/etc/group",
    "--ro-bind",
    "/etc/nsswitch.conf",
    "/etc/nsswitch.conf",
    "--ro-bind",
    "/etc/localtime",
    "/etc/localtime",
    "--proc",
    "/proc",
    "--dev",
    "/dev",
    "--tmpfs",
    "/tmp",
    "--tmpfs",
    "/home",
    "--dir",
    "/home/probe",
    "--dir",
    homeRoot,
    "--dir",
    join(homeRoot, ".local"),
    "--dir",
    join(homeRoot, ".local/lib"),
    "--dir",
    join(homeRoot, ".local/lib/python3.12"),
    "--dir",
    join(homeRoot, ".local/lib/python3.12/site-packages"),
    "--dir",
    numpySite,
    "--ro-bind",
    numpyPath,
    numpyPath,
    "--bind",
    workdir,
    "/work",
    "--chdir",
    "/work",
    "--setenv",
    "HOME",
    "/home/probe",
    "--setenv",
    "TMPDIR",
    "/tmp",
    "--setenv",
    "XDG_CONFIG_HOME",
    "/home/probe/.config",
    "--setenv",
    "BLENDER_USER_CONFIG",
    "/home/probe/.config/blender",
    "--setenv",
    "BLENDER_USER_SCRIPTS",
    "/home/probe/scripts",
    "--setenv",
    "BLENDER_USER_EXTENSIONS",
    "/home/probe/extensions",
    "--setenv",
    "PYTHONPATH",
    numpySite,
    "--setenv",
    "OPENBLAS_NUM_THREADS",
    "1",
    "--setenv",
    "OMP_NUM_THREADS",
    "1",
    "--setenv",
    "MKL_NUM_THREADS",
    "1",
    "--setenv",
    "BLIS_NUM_THREADS",
    "1",
    "--setenv",
    "LANG",
    "C.UTF-8",
    "--setenv",
    "LC_ALL",
    "C.UTF-8",
    "/usr/bin/blender",
    "--background",
    "--factory-startup",
    "--disable-autoexec",
    "--python",
    "/work/job.py",
  ];
  if (existsSync(numpyLibs)) {
    args.splice(
      args.indexOf("/usr/bin/blender"),
      0,
      "--ro-bind",
      numpyLibs,
      numpyLibs,
    );
  }
  return args;
}

function findNumpyPath() {
  const candidate =
    process.env.ORBSIE_BLENDER_NUMPY_PATH ||
    join(
      process.env.HOME || "/home/probe",
      ".local/lib/python3.12/site-packages/numpy",
    );
  if (!existsSync(candidate)) {
    throw new Error(
      `Blender's system package needs numpy for its GLB exporter; set ORBSIE_BLENDER_NUMPY_PATH to a read-only numpy package (${candidate} not found)`,
    );
  }
  return candidate;
}

function validateGlb(buffer) {
  if (buffer.length < 20 || buffer.toString("ascii", 0, 4) !== "glTF") {
    throw new Error("output is not a GLB (missing glTF magic)");
  }
  const version = buffer.readUInt32LE(4);
  const declaredLength = buffer.readUInt32LE(8);
  if (version !== 2) throw new Error(`unsupported GLB version ${version}`);
  if (declaredLength !== buffer.length) {
    throw new Error(
      `GLB length header ${declaredLength} does not match ${buffer.length} bytes`,
    );
  }
  const jsonChunkLength = buffer.readUInt32LE(12);
  const jsonChunkType = buffer.readUInt32LE(16);
  if (jsonChunkType !== 0x4e4f534a)
    throw new Error("GLB first chunk is not JSON");
  const jsonStart = 20;
  const jsonEnd = jsonStart + jsonChunkLength;
  if (jsonEnd > buffer.length)
    throw new Error("GLB JSON chunk exceeds file length");
  const document = JSON.parse(
    buffer
      .toString("utf8", jsonStart, jsonEnd)
      .replace(/\u0000+$/g, "")
      .trim(),
  );
  if (document.asset?.version !== "2.0")
    throw new Error("GLB JSON asset version is not 2.0");
  return {
    version,
    declaredLength,
    jsonChunkLength,
    meshes: Array.isArray(document.meshes) ? document.meshes.length : 0,
    materials: Array.isArray(document.materials)
      ? document.materials.length
      : 0,
    nodes: Array.isArray(document.nodes) ? document.nodes.length : 0,
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!existsSync(BLENDER))
    throw new Error(`Blender binary not found at ${BLENDER}`);
  if (!existsSync(BWRAP))
    throw new Error(`bubblewrap binary not found at ${BWRAP}`);

  const blenderVersion = commandVersion(BLENDER, ["--version"]).split(
    /\r?\n/,
  )[0];
  const bwrapVersion = commandVersion(BWRAP, ["--version"]).split(/\r?\n/)[0];
  const numpyPath = findNumpyPath();
  const workdir = mkdtempSync(join(tmpdir(), "orbsie-blender-probe-"));
  const outputPath =
    options.output || join(tmpdir(), `orbsie-blender-probe-${process.pid}.glb`);
  writeFileSync(join(workdir, "job.py"), TRUSTED_JOB, {
    encoding: "utf8",
    mode: 0o600,
  });

  const started = performance.now();
  const child = spawnSync(
    "/usr/bin/timeout",
    [
      "--signal=TERM",
      "--kill-after=2s",
      `${JOB_TIMEOUT_SECONDS}s`,
      "/usr/bin/prlimit",
      `--cpu=${CPU_LIMIT_SECONDS}`,
      `--as=${MEMORY_LIMIT_BYTES}`,
      `--fsize=${OUTPUT_LIMIT_BYTES}`,
      `--nproc=${PROCESS_LIMIT}`,
      "--",
      BWRAP,
      ...buildBubblewrapArgs(workdir, numpyPath),
    ],
    { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
  );
  const elapsedMs = Math.round(performance.now() - started);

  try {
    if (child.error) throw child.error;
    if (child.status !== 0) {
      const output = `${child.stdout || ""}${child.stderr || ""}`.trim();
      throw new Error(
        `isolated Blender job exited ${child.status}${output ? `: ${output}` : ""}`,
      );
    }

    const resultPath = join(workdir, "result.json");
    const generatedPath = join(workdir, "probe.glb");
    if (!existsSync(resultPath) || !existsSync(generatedPath)) {
      const output = `${child.stdout || ""}${child.stderr || ""}`.trim();
      throw new Error(
        `isolated Blender job produced no complete result${output ? `: ${output}` : ""}`,
      );
    }
    const result = JSON.parse(readFileSync(resultPath, "utf8"));
    const generated = readFileSync(generatedPath);
    const glb = validateGlb(generated);
    if (generated.length > OUTPUT_LIMIT_BYTES)
      throw new Error("output exceeds configured size limit");
    writeFileSync(outputPath, generated, { mode: 0o600 });
    const report = {
      status: "ok",
      platform: `${process.platform}/${process.arch}`,
      blender: blenderVersion,
      bubblewrap: bwrapVersion,
      elapsedMs,
      outputPath,
      outputBytes: generated.length,
      glb,
      job: result,
      restrictions: {
        network: "unshared (no network namespace interfaces)",
        filesystem:
          "read-only allowlist for Blender/system runtime; writable /work only",
        credentials:
          "project tree and credential files are not mounted; only NumPy is mounted read-only",
        timeoutSeconds: JOB_TIMEOUT_SECONDS,
        cpuSeconds: CPU_LIMIT_SECONDS,
        memoryBytes: MEMORY_LIMIT_BYTES,
        outputBytes: OUTPUT_LIMIT_BYTES,
        processCount: PROCESS_LIMIT,
        code: "trusted repository-owned procedural probe only",
      },
    };
    console.log(JSON.stringify(report, null, 2));
  } finally {
    if (!options.keepWorkdir) rmSync(workdir, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  console.error(
    JSON.stringify({ status: "error", message: error.message }, null, 2),
  );
  process.exitCode = 1;
}
