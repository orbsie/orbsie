import Module from "manifold-3d";
import {
  evaluateBrowserModelRecipe,
  type BrowserModelEvaluation,
  type BrowserModelKernel,
} from "./browser-modeling-kernel";
import {
  browserModelRecipeSchema,
  type BrowserModelRecipe,
} from "./browser-modeling";

export interface BrowserModelWorkerRequest {
  readonly type: "evaluate";
  readonly jobId: string;
  readonly recipe: BrowserModelRecipe;
}

export interface BrowserModelWorkerSuccess {
  readonly type: "result";
  readonly jobId: string;
  readonly revision: number;
  readonly vertices: Float32Array;
  readonly indices: Uint32Array;
  readonly bounds: BrowserModelEvaluation["bounds"];
  readonly statistics: BrowserModelEvaluation["statistics"];
}

export interface BrowserModelWorkerFailure {
  readonly type: "error";
  readonly jobId: string;
  readonly revision: number;
  readonly error: string;
}

export type BrowserModelWorkerResponse =
  BrowserModelWorkerSuccess | BrowserModelWorkerFailure;

type ManifoldModule = Awaited<ReturnType<typeof Module>>;

function createKernel(manifold: ManifoldModule): BrowserModelKernel {
  return {
    cube: (size, center) => manifold.Manifold.cube(size, center),
    sphere: (radius, segments) => manifold.Manifold.sphere(radius, segments),
    extrude: (profile, depth) => manifold.Manifold.extrude(profile, depth),
    cylinder: (depth, radiusLow, radiusHigh, segments, center) =>
      manifold.Manifold.cylinder(
        depth,
        radiusLow,
        radiusHigh,
        segments,
        center,
      ),
    revolve: (profile, segments, degrees) =>
      manifold.Manifold.revolve(profile, segments, degrees),
    compose: (manifolds) =>
      manifold.Manifold.compose(
        manifolds as unknown as ReturnType<typeof manifold.Manifold.cube>[],
      ),
    mesh: (vertices, triangles) =>
      manifold.Manifold.ofMesh(
        new manifold.Mesh({
          numProp: 3,
          vertProperties: vertices,
          triVerts: triangles,
        }),
      ),
  };
}

let manifoldPromise: Promise<ManifoldModule> | undefined;

function getManifold(): Promise<ManifoldModule> {
  manifoldPromise ??= Module({
    locateFile: () =>
      new URL("/modeling/manifold.wasm", globalThis.location.origin).href,
  }).then((manifold) => {
    manifold.setup();
    return manifold;
  });
  return manifoldPromise;
}

function requestFrom(value: unknown): BrowserModelWorkerRequest {
  if (!value || typeof value !== "object")
    throw new Error("Browser modeling worker received an invalid request.");
  const request = value as Partial<BrowserModelWorkerRequest>;
  if (request.type !== "evaluate" || typeof request.jobId !== "string")
    throw new Error("Browser modeling worker received an invalid request.");
  return {
    type: "evaluate",
    jobId: request.jobId,
    recipe: browserModelRecipeSchema.parse(request.recipe),
  };
}

function failure(
  value: unknown,
  jobId = "",
  revision = -1,
): BrowserModelWorkerFailure {
  return {
    type: "error",
    jobId,
    revision,
    error: value instanceof Error ? value.message : "Browser modeling failed.",
  };
}

const scope = globalThis as unknown as {
  onmessage: (event: MessageEvent<BrowserModelWorkerRequest>) => void;
  postMessage: (
    value: BrowserModelWorkerResponse,
    transfer?: Transferable[],
  ) => void;
};

scope.onmessage = async ({ data }) => {
  let request: BrowserModelWorkerRequest | undefined;
  try {
    request = requestFrom(data);
    const manifold = await getManifold();
    const evaluation = evaluateBrowserModelRecipe(
      request.recipe,
      createKernel(manifold),
    );
    const response: BrowserModelWorkerSuccess = {
      type: "result",
      jobId: request.jobId,
      revision: request.recipe.revision,
      vertices: evaluation.vertices,
      indices: evaluation.indices,
      bounds: evaluation.bounds,
      statistics: evaluation.statistics,
    };
    scope.postMessage(response, [
      response.vertices.buffer,
      response.indices.buffer,
    ]);
  } catch (error) {
    scope.postMessage(failure(error, request?.jobId, request?.recipe.revision));
  }
};
