import variant from "@jitl/quickjs-wasmfile-release-sync";
import {
  newQuickJSWASMModuleFromVariant,
  type QuickJSContext,
  type QuickJSRuntime,
} from "quickjs-emscripten-core";
import {
  BROWSER_PROCEDURAL_DEADLINE_MS,
  BROWSER_PROCEDURAL_MEMORY_LIMIT_BYTES,
  BROWSER_PROCEDURAL_OUTPUT_MAX_BYTES,
  BROWSER_PROCEDURAL_STACK_LIMIT_BYTES,
  BrowserProceduralError,
  parseBrowserProceduralSource,
  validateProceduralRecipe,
  type BrowserProceduralEvaluationOptions,
  type BrowserProceduralSource,
} from "./browser-procedural";
import type { BrowserModelRecipe } from "./browser-modeling";

type QuickJSModule = Awaited<
  ReturnType<typeof newQuickJSWASMModuleFromVariant>
>;

let modulePromise: Promise<QuickJSModule> | undefined;

function quickJSModule(): Promise<QuickJSModule> {
  modulePromise ??= newQuickJSWASMModuleFromVariant(variant);
  return modulePromise;
}

function monotonicNow(): number {
  return globalThis.performance?.now() ?? Date.now();
}

function safeRuntimeDispose(runtime: QuickJSRuntime | undefined): void {
  try {
    runtime?.dispose();
  } catch {
    // The worker is disposable at the queue boundary even if a guest leaked a handle.
  }
}

function safeContextDispose(context: QuickJSContext | undefined): void {
  try {
    context?.dispose();
  } catch {
    // The worker is disposable at the queue boundary even if a guest leaked a handle.
  }
}

function bootstrapProgram(seed: number): string {
  const initialSeed = seed >>> 0;
  return `(function () {
    "use strict";
    let state = (${initialSeed} === 0 ? 0x6d2b79f5 : ${initialSeed}) >>> 0;
    const initialSeed = ${initialSeed} >>> 0;
    function random() {
      state = (state ^ (state << 13)) >>> 0;
      state = (state ^ (state >>> 17)) >>> 0;
      state = (state ^ (state << 5)) >>> 0;
      return state / 4294967296;
    }
    function randomInt(maxExclusive) {
      if (!Number.isInteger(maxExclusive) || maxExclusive <= 0)
        throw new Error("Invalid random bound");
      return Math.floor(random() * maxExclusive);
    }
    const orb = Object.freeze({
      seed: initialSeed,
      random,
      randomInt,
    });
    Object.defineProperty(globalThis, "orb", {
      value: orb,
      writable: false,
      configurable: false,
      enumerable: false,
    });
    Math.random = random;
    globalThis.Date = undefined;
    globalThis.WebAssembly = undefined;
    globalThis.SharedArrayBuffer = undefined;
    globalThis.Atomics = undefined;
    return true;
  })()`;
}

function serializerProgram(): string {
  const outputLimit = BROWSER_PROCEDURAL_OUTPUT_MAX_BYTES;
  return `(function () {
    "use strict";
    const stringify = JSON.stringify;
    const charCodeAt = String.prototype.charCodeAt;
    const apply = Reflect.apply;
    const outputLimit = ${outputLimit};
    function utf8Length(text) {
      let bytes = 0;
      for (let index = 0; index < text.length; index += 1) {
        const code = apply(charCodeAt, text, [index]);
        if (code <= 0x7f) bytes += 1;
        else if (code <= 0x7ff) bytes += 2;
        else if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length &&
          apply(charCodeAt, text, [index + 1]) >= 0xdc00 &&
          apply(charCodeAt, text, [index + 1]) <= 0xdfff) {
          bytes += 4;
          index += 1;
        } else bytes += 3;
        if (bytes > outputLimit) return bytes;
      }
      return bytes;
    }
    return function (value) {
      const serialized = apply(stringify, JSON, [value]);
      if (typeof serialized !== "string") return "__ORBSIE_PROCEDURAL_INVALID__";
      if (utf8Length(serialized) > outputLimit)
        return "__ORBSIE_PROCEDURAL_OUTPUT_LIMIT__";
      return serialized;
    };
  })()`;
}

function guestProgram(source: BrowserProceduralSource): string {
  return `(function () {
    "use strict";
    return (${source.code});
  })()`;
}

function disposeResult(result: {
  value?: { dispose(): void };
  error?: { dispose(): void };
}): void {
  if (result.value) result.value.dispose();
  if (result.error) result.error.dispose();
}

function executionError(
  result: { error?: { dispose(): void } },
  interrupted: boolean,
  signal?: AbortSignal,
): never {
  disposeResult(result);
  throw publicExecutionError(interrupted, signal);
}

function publicExecutionError(
  interrupted: boolean,
  signal?: AbortSignal,
): BrowserProceduralError {
  if (signal?.aborted)
    return new BrowserProceduralError(
      "aborted",
      "Procedural authoring was cancelled.",
    );
  if (interrupted)
    return new BrowserProceduralError(
      "timeout",
      "Procedural authoring timed out.",
    );
  return new BrowserProceduralError("execution");
}

export async function evaluateBrowserProceduralSource(
  input: unknown,
  options: BrowserProceduralEvaluationOptions = {},
): Promise<BrowserModelRecipe> {
  const source = parseBrowserProceduralSource(input);
  if (options.signal?.aborted)
    throw new BrowserProceduralError(
      "aborted",
      "Procedural authoring was cancelled.",
    );
  const deadline = options.deadlineMs ?? BROWSER_PROCEDURAL_DEADLINE_MS;
  if (
    !Number.isFinite(deadline) ||
    deadline <= 0 ||
    deadline > BROWSER_PROCEDURAL_DEADLINE_MS
  )
    throw new BrowserProceduralError("execution");
  const now = options.now ?? monotonicNow;
  const quickjs = await quickJSModule();
  if (options.signal?.aborted)
    throw new BrowserProceduralError(
      "aborted",
      "Procedural authoring was cancelled.",
    );
  const deadlineAt = now() + deadline;

  let runtime: QuickJSRuntime | undefined;
  let context: QuickJSContext | undefined;
  let interrupted = false;
  try {
    runtime = quickjs.newRuntime();
    runtime.setMemoryLimit(BROWSER_PROCEDURAL_MEMORY_LIMIT_BYTES);
    runtime.setMaxStackSize(BROWSER_PROCEDURAL_STACK_LIMIT_BYTES);
    runtime.removeModuleLoader();
    runtime.setInterruptHandler(() => {
      const shouldStop =
        Boolean(options.signal?.aborted) || now() >= deadlineAt;
      interrupted ||= shouldStop;
      return shouldStop;
    });
    context = runtime.newContext();
    const bootstrap = context.evalCode(
      bootstrapProgram(source.seed),
      "orbsie-procedural-bootstrap.js",
    );
    if ("error" in bootstrap && bootstrap.error)
      executionError(bootstrap, interrupted, options.signal);
    bootstrap.value.dispose();

    const validatorResult = context.evalCode(
      serializerProgram(),
      "orbsie-procedural-validator.js",
    );
    if ("error" in validatorResult && validatorResult.error)
      executionError(validatorResult, interrupted, options.signal);
    const validator = validatorResult.value;
    try {
      if (context.typeof(validator) !== "function")
        throw new BrowserProceduralError("execution");

      const guestResult = context.evalCode(
        guestProgram(source),
        "orbsie-procedural.js",
      );
      if ("error" in guestResult && guestResult.error)
        executionError(guestResult, interrupted, options.signal);
      const guest = guestResult.value;
      try {
        const serializedResult = context.callFunction(
          validator,
          context.undefined,
          guest,
        );
        if ("error" in serializedResult && serializedResult.error)
          executionError(serializedResult, interrupted, options.signal);
        const serializedHandle = serializedResult.value;
        try {
          if (context.typeof(serializedHandle) !== "string")
            throw new BrowserProceduralError("execution");
          const serialized = context.getString(serializedHandle);
          if (serialized === "__ORBSIE_PROCEDURAL_OUTPUT_LIMIT__")
            throw new BrowserProceduralError("output-limit");
          if (serialized === "__ORBSIE_PROCEDURAL_INVALID__")
            throw new BrowserProceduralError("invalid-recipe");
          if (
            new TextEncoder().encode(serialized).byteLength >
            BROWSER_PROCEDURAL_OUTPUT_MAX_BYTES
          )
            throw new BrowserProceduralError("output-limit");
          let value: unknown;
          try {
            value = JSON.parse(serialized);
          } catch {
            throw new BrowserProceduralError("invalid-recipe");
          }
          return validateProceduralRecipe(value);
        } finally {
          serializedHandle.dispose();
        }
      } finally {
        guest.dispose();
      }
    } finally {
      validator.dispose();
    }
  } catch (error) {
    if (error instanceof BrowserProceduralError) throw error;
    throw publicExecutionError(interrupted, options.signal);
  } finally {
    safeContextDispose(context);
    safeRuntimeDispose(runtime);
  }
}
