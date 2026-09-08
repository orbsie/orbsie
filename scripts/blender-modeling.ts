import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { modelingJobSchema, type ModelingJob } from "../src/lib/modeling";
import { validateGeneratedGLB } from "../src/lib/generated-glb";

const BLENDER = process.env.ORBSIE_BLENDER_PATH || "/usr/bin/blender";
const BWRAP = process.env.ORBSIE_BWRAP_PATH || "/usr/bin/bwrap";
const TIMEOUT_SECONDS = 30;
const CPU_SECONDS = 20;
const MEMORY_BYTES = 2 * 1024 * 1024 * 1024;
// Keep the process limit aligned with generated-model persistence and the
// shared pre-loader validator.
const OUTPUT_BYTES = 2 * 1024 * 1024;
// Blender itself may write bounded startup/configuration files while the
// generated artifact remains capped by OUTPUT_BYTES and validateGeneratedGLB.
const PROCESS_FILE_BYTES = 64 * 1024 * 1024;
const INPUT_BYTES = 512 * 1024;
const PROCESS_LIMIT = 4096;
const DIAGNOSTIC_BYTES = 128 * 1024;
const PROGRESS_PREFIX = "ORBSIE_PROGRESS ";

export type ModelingStage =
  "validation" | "modeling" | "exporting" | "complete";

export type ModelingProgress = {
  stage: ModelingStage;
  progress: number;
  message: string;
};

export type ModelingBounds = {
  min: [number, number, number];
  max: [number, number, number];
  size: [number, number, number];
};

export type ModelingMaterialStat = {
  name: string;
  color: string;
  parts: string[];
};

export type ModelingObjectStat = {
  id: string;
  shape: ModelingJob["parts"][number]["shape"];
  vertices: number;
  triangles: number;
};

export type BlenderModelingResult = {
  glb: Uint8Array;
  sha256: string;
  bounds: ModelingBounds;
  materialStats: ModelingMaterialStat[];
  objects: ModelingObjectStat[];
  blenderVersion: string;
};

export type BlenderModelingOptions = {
  signal?: AbortSignal;
  onProgress?: (progress: ModelingProgress) => void;
};

export class BlenderModelingAbortError extends Error {
  constructor() {
    super("The Blender modeling job was cancelled.");
    this.name = "AbortError";
  }
}

function emit(
  onProgress: BlenderModelingOptions["onProgress"],
  progress: ModelingProgress,
) {
  onProgress?.(progress);
}

function assertFiniteVector(
  value: unknown,
  label: string,
): asserts value is [number, number, number] {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    value.some(
      (component) =>
        typeof component !== "number" || !Number.isFinite(component),
    )
  )
    throw new Error(`Blender returned invalid ${label} bounds.`);
}

function findNumpyPath() {
  const candidate =
    process.env.ORBSIE_BLENDER_NUMPY_PATH ||
    join(
      process.env.HOME || "/home/probe",
      ".local/lib/python3.12/site-packages/numpy",
    );
  if (!existsSync(candidate))
    throw new Error(
      `Blender's GLB exporter needs numpy at a pinned local path (${candidate} was not found).`,
    );
  return candidate;
}

function buildBubblewrapArgs(workdir: string, numpyPath: string) {
  const numpySite = dirname(numpyPath);
  const numpyLibs = join(numpySite, "numpy.libs");
  const homeRoot = process.env.HOME || dirname(dirname(dirname(numpySite)));
  const homeRelative = relative("/home", homeRoot);
  if (homeRelative.startsWith("..") || homeRelative.includes("/"))
    throw new Error(
      `NumPy path must be under /home for isolated Blender jobs.`,
    );
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
    ...(existsSync(numpyLibs) ? ["--ro-bind", numpyLibs, numpyLibs] : []),
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
    "PYTHONUNBUFFERED",
    "1",
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
    BLENDER,
    "--background",
    "--factory-startup",
    "--disable-autoexec",
    "--python",
    "/work/blender-modeling.py",
  ];
  return args;
}

function killProcessGroup(pid: number | undefined, signal: NodeJS.Signals) {
  if (!pid) return;
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      // The timeout wrapper or Blender already exited.
    }
  }
}

function runIsolated(
  workdir: string,
  onProgress: BlenderModelingOptions["onProgress"],
  signal?: AbortSignal,
) {
  return new Promise<{
    code: number | null;
    output: string;
    cancelled: boolean;
  }>((resolve, reject) => {
    const numpyPath = findNumpyPath();
    const child = spawn(
      "/usr/bin/timeout",
      [
        "--foreground",
        "--signal=TERM",
        "--kill-after=2s",
        `${TIMEOUT_SECONDS}s`,
        "/usr/bin/prlimit",
        `--cpu=${CPU_SECONDS}`,
        `--as=${MEMORY_BYTES}`,
        `--fsize=${PROCESS_FILE_BYTES}`,
        `--nproc=${PROCESS_LIMIT}`,
        "--",
        BWRAP,
        ...buildBubblewrapArgs(workdir, numpyPath),
      ],
      { cwd: workdir, detached: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    let output = "";
    let lineBuffer = "";
    let cancelled = false;
    let settled = false;
    let progressError: unknown;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    let abortHandler: (() => void) | undefined;
    const cleanup = () => {
      if (abortHandler) signal?.removeEventListener("abort", abortHandler);
      if (killTimer !== undefined) clearTimeout(killTimer);
    };
    const terminate = () => {
      killProcessGroup(child.pid, "SIGTERM");
      if (killTimer === undefined)
        killTimer = setTimeout(() => {
          killProcessGroup(child.pid, "SIGKILL");
        }, 2_000);
    };
    const finish = (error?: unknown, code?: number | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error !== undefined) reject(error);
      else if (progressError !== undefined) reject(progressError);
      else resolve({ code: code ?? null, output, cancelled });
    };
    const reportProgress = (progress: ModelingProgress) => {
      try {
        emit(onProgress, progress);
      } catch (error) {
        // A consumer callback runs in the stdout event loop. Letting its
        // exception escape would bypass close/error cleanup and leak Blender.
        progressError ??= error;
        terminate();
      }
    };
    const append = (chunk: Buffer | string) => {
      const text = chunk.toString();
      output = (output + text).slice(-DIAGNOSTIC_BYTES);
      lineBuffer = (lineBuffer + text).slice(-DIAGNOSTIC_BYTES);
      const lines = lineBuffer.split(/\r?\n/);
      lineBuffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.startsWith(PROGRESS_PREFIX)) continue;
        let parsed: ModelingProgress;
        try {
          parsed = JSON.parse(
            line.slice(PROGRESS_PREFIX.length),
          ) as ModelingProgress;
        } catch {
          // Blender diagnostics are not progress events.
          continue;
        }
        if (
          (parsed.stage === "modeling" || parsed.stage === "exporting") &&
          Number.isFinite(parsed.progress) &&
          typeof parsed.message === "string"
        )
          reportProgress(parsed);
      }
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    if (signal) {
      abortHandler = () => {
        cancelled = true;
        terminate();
      };
      if (signal.aborted) abortHandler();
      else signal.addEventListener("abort", abortHandler, { once: true });
    }
    child.once("error", (error) => finish(error));
    child.once("close", (code) => finish(undefined, code));
  });
}

function validatedBounds(value: unknown): ModelingBounds {
  if (!value || typeof value !== "object")
    throw new Error("Blender returned no model bounds.");
  const bounds = value as { min?: unknown; max?: unknown };
  assertFiniteVector(bounds.min, "minimum");
  assertFiniteVector(bounds.max, "maximum");
  const min = bounds.min;
  const max = bounds.max;
  if (min.some((component, index) => component > max[index]))
    throw new Error("Blender returned inverted model bounds.");
  return {
    min,
    max,
    size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
  };
}

function validatedResult(
  value: unknown,
  job: ModelingJob,
): Omit<BlenderModelingResult, "glb" | "sha256"> {
  if (!value || typeof value !== "object")
    throw new Error("Blender returned no modeling metadata.");
  const result = value as {
    version?: unknown;
    blenderVersion?: unknown;
    bounds?: unknown;
    materials?: unknown;
    objects?: unknown;
  };
  if (result.version !== 1 || typeof result.blenderVersion !== "string")
    throw new Error("Blender returned unsupported modeling metadata.");
  if (!Array.isArray(result.materials) || !Array.isArray(result.objects))
    throw new Error("Blender returned incomplete modeling metadata.");
  const materialStats = result.materials.map((material) => {
    if (!material || typeof material !== "object")
      throw new Error("Blender returned invalid material metadata.");
    const value = material as {
      name?: unknown;
      color?: unknown;
      parts?: unknown;
    };
    if (
      typeof value.name !== "string" ||
      typeof value.color !== "string" ||
      !/^#[0-9a-fA-F]{6}$/.test(value.color) ||
      !Array.isArray(value.parts) ||
      value.parts.some((part) => typeof part !== "string")
    )
      throw new Error("Blender returned invalid material metadata.");
    return {
      name: value.name,
      color: value.color,
      parts: value.parts as string[],
    };
  });
  const objects = result.objects.map((object) => {
    if (!object || typeof object !== "object")
      throw new Error("Blender returned invalid object metadata.");
    const value = object as {
      id?: unknown;
      shape?: unknown;
      vertices?: unknown;
      triangles?: unknown;
    };
    const vertices = value.vertices;
    const triangles = value.triangles;
    if (
      typeof value.id !== "string" ||
      typeof value.shape !== "string" ||
      !Number.isSafeInteger(vertices) ||
      !Number.isSafeInteger(triangles) ||
      (vertices as number) < 0 ||
      (triangles as number) < 0
    )
      throw new Error("Blender returned invalid object metadata.");
    return value as ModelingObjectStat;
  });
  if (objects.length !== job.parts.length)
    throw new Error("Blender returned metadata for the wrong number of parts.");
  for (const [index, object] of objects.entries()) {
    if (
      object.id !== job.parts[index].id ||
      object.shape !== job.parts[index].shape
    )
      throw new Error("Blender returned metadata for an unexpected part.");
  }
  return {
    bounds: validatedBounds(result.bounds),
    materialStats,
    objects,
    blenderVersion: result.blenderVersion,
  };
}

export async function runBlenderModelingJob(
  input: unknown,
  options: BlenderModelingOptions = {},
): Promise<BlenderModelingResult> {
  if (process.platform !== "linux")
    throw new Error(
      "The isolated Blender companion currently supports Linux only.",
    );
  if (!existsSync(BLENDER))
    throw new Error(`Blender was not found at ${BLENDER}.`);
  if (!existsSync(BWRAP))
    throw new Error(`bubblewrap was not found at ${BWRAP}.`);
  if (options.signal?.aborted) throw new BlenderModelingAbortError();
  const job = modelingJobSchema.parse(input);
  const jobData = Buffer.from(JSON.stringify(job));
  if (jobData.byteLength > INPUT_BYTES)
    throw new Error("The modeling job exceeds the input size limit.");
  emit(options.onProgress, {
    stage: "validation",
    progress: 1,
    message: "Modeling job validated",
  });
  const workdir = mkdtempSync(join(tmpdir(), "orbsie-blender-modeling-"));
  try {
    writeFileSync(join(workdir, "job.json"), jobData, { mode: 0o600 });
    writeFileSync(
      join(workdir, "blender-modeling.py"),
      readFileSync(
        fileURLToPath(new URL("./blender-modeling.py", import.meta.url)),
      ),
      { mode: 0o600 },
    );
    emit(options.onProgress, {
      stage: "modeling",
      progress: 0,
      message: "Starting isolated Blender job",
    });
    const processResult = await runIsolated(
      workdir,
      options.onProgress,
      options.signal,
    );
    if (processResult.cancelled || options.signal?.aborted)
      throw new BlenderModelingAbortError();
    if (processResult.code !== 0) {
      throw new Error(
        `The isolated Blender job failed (exit code ${processResult.code})${processResult.output ? `: ${processResult.output}` : "."}`,
      );
    }
    const outputPath = join(workdir, "model.glb");
    const resultPath = join(workdir, "result.json");
    if (!existsSync(outputPath) || !existsSync(resultPath))
      throw new Error(
        `The isolated Blender job produced no complete result${processResult.output ? `: ${processResult.output}` : "."}`,
      );
    const outputStat = statSync(outputPath);
    if (outputStat.size > OUTPUT_BYTES)
      throw new Error("The Blender GLB exceeds the output size limit.");
    const glb = new Uint8Array(readFileSync(outputPath));
    emit(options.onProgress, {
      stage: "validation",
      progress: 0.5,
      message: "Validating exported GLB",
    });
    validateGeneratedGLB(glb);
    const metadata = validatedResult(
      JSON.parse(readFileSync(resultPath, "utf8")),
      job,
    );
    const digest = createHash("sha256").update(glb).digest("hex");
    emit(options.onProgress, {
      stage: "complete",
      progress: 1,
      message: "Validated GLB ready",
    });
    return { ...metadata, glb, sha256: digest };
  } finally {
    rmSync(workdir, { recursive: true, force: true });
  }
}
