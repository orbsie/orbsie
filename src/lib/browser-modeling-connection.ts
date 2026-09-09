import {
  browserModelRecipeSchema,
  type BrowserModelRecipe,
} from "./browser-modeling";
import { evaluateBrowserModelRecipeInWorker } from "./browser-modeling-queue";
import { bakeBrowserModelGLB } from "./browser-modeling-glb";
import { saveGeneratedModel } from "./generated-models";

export const BROWSER_MANIFOLD_KERNEL_VERSION = "3.3.2";

export interface BrowserModelBuildOptions {
  readonly color: string;
  readonly signal?: AbortSignal;
}

/** Construct and persist a browser-manifold model behind the store boundary. */
export async function buildBrowserModel(
  input: BrowserModelRecipe,
  options: BrowserModelBuildOptions,
) {
  const recipe = browserModelRecipeSchema.parse(input);
  const signal = options.signal;
  signal?.throwIfAborted();
  const evaluation = await evaluateBrowserModelRecipeInWorker(
    recipe,
    signal ?? new AbortController().signal,
  );
  signal?.throwIfAborted();
  const glb = bakeBrowserModelGLB(evaluation, { color: options.color });
  signal?.throwIfAborted();
  return saveGeneratedModel(glb, {
    source: "browser-manifold",
    kernelVersion: BROWSER_MANIFOLD_KERNEL_VERSION,
    bounds: evaluation.bounds,
  });
}
