import type { ChatGPTDeviceRpc } from "./chatgpt-device-session";
import type { ChatGPTModel } from "./chatgpt-models";
import {
  CHATGPT_GENERATION_CONFIG,
  CHATGPT_READ_POLICY,
} from "./chatgpt-generation-policy";

const MAX_INSTRUCTIONS = 64 * 1024;
const MAX_INPUT = 256 * 1024;
const MAX_DELTA = 64 * 1024;
const MAX_OUTPUT = 512 * 1024;
const MAX_DELTAS = 8192;
const DEFAULT_TIMEOUT = 180_000;
const INTERRUPT_TIMEOUT = 5_000;
const THREAD_START = "thread/start";
const TURN_START = "turn/start";
const TURN_INTERRUPT = "turn/interrupt";
const GENERIC = "ChatGPT generation could not be completed.";
const CANCELLED = "ChatGPT generation was canceled.";
const TIMED_OUT = "ChatGPT generation timed out.";
const MODEL_UNAVAILABLE = "The requested ChatGPT model is unavailable.";
const ALREADY_RUNNING = "A ChatGPT generation is already running.";
const INVALID_INPUT = "ChatGPT generation input is invalid.";
const ABORTED = Symbol("chatgpt-generation-aborted");

type GenerateInput = {
  model: string;
  effort: string;
  instructions: string;
  input: string;
  onText(delta: string): void;
  signal?: AbortSignal;
};

type GenerationOptions = {
  rpc: ChatGPTDeviceRpc;
  models: () => Promise<ChatGPTModel[]>;
  dispose: () => Promise<void>;
  timeoutMs?: number;
};

type RecordValue = Record<string, unknown>;
type BufferedDelta = { text: string; turnId: string; sequence: number };
type Terminal = { turnId: string; ok: boolean; sequence: number };

function record(value: unknown): RecordValue | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : null;
}

function text(value: unknown, maxBytes: number): value is string {
  return (
    typeof value === "string" &&
    new TextEncoder().encode(value).byteLength <= maxBytes
  );
}

function id(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9._:/-]{1,256}$/.test(value);
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function modelAvailable(
  catalog: ChatGPTModel[],
  requestedModel: string,
  effort: string,
): boolean {
  return catalog.some(
    (entry) =>
      record(entry) !== null &&
      entry.model === requestedModel &&
      Array.isArray(entry.supportedReasoningEfforts) &&
      entry.supportedReasoningEfforts.includes(effort),
  );
}

function awaitAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(ABORTED);
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const abort = () => {
      if (settled) return;
      settled = true;
      reject(ABORTED);
    };
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      () => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", abort);
        reject(GENERIC);
      },
    );
  });
}

function rpcRequest(
  rpc: ChatGPTDeviceRpc,
  method: string,
  params: unknown,
  signal: AbortSignal,
): Promise<unknown> {
  return awaitAbort(
    Promise.resolve().then(() => rpc.request(method, params)),
    signal,
  );
}

function boundedInterrupt(
  rpc: ChatGPTDeviceRpc,
  threadId: string,
  turnId: string,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const request = Promise.resolve()
    .then(() => rpc.request(TURN_INTERRUPT, { threadId, turnId }))
    .then(
      () => true,
      () => false,
    );
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), INTERRUPT_TIMEOUT);
  });
  return Promise.race([request, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

function toolRequest(method: string, rawParams: unknown): boolean {
  const params = record(rawParams);
  const item = record(params?.item);
  const itemType = item?.type;
  if (
    itemType === "commandExecution" ||
    itemType === "fileChange" ||
    itemType === "mcpToolCall" ||
    itemType === "shellCommand"
  )
    return true;
  return (
    /(?:commandexecution|mcp.?tool|filechange|approval|shell|exec)/i.test(
      method,
    ) && /(?:request|call|execute)/i.test(method)
  );
}

function eventTurnId(params: RecordValue): string | undefined {
  return id(params.turnId) ? params.turnId : undefined;
}

function terminalStatus(params: RecordValue): boolean | undefined {
  const turn = record(params.turn) ?? params;
  if (turn.status === "completed") return true;
  if (
    turn.status === "failed" ||
    turn.status === "cancelled" ||
    turn.status === "interrupted"
  )
    return false;
  return undefined;
}

function publicError(
  error: unknown,
  timedOut: boolean,
  cancelled: boolean,
): Error {
  if (timedOut) return Error(TIMED_OUT);
  if (cancelled) return Error(CANCELLED);
  if (error === MODEL_UNAVAILABLE) return Error(MODEL_UNAVAILABLE);
  if (error === INVALID_INPUT) return Error(INVALID_INPUT);
  return Error(GENERIC);
}

export function createChatGPTGeneration(options: GenerationOptions) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT;
  if (
    !options.rpc ||
    typeof options.rpc.request !== "function" ||
    typeof options.rpc.subscribe !== "function" ||
    typeof options.models !== "function" ||
    typeof options.dispose !== "function" ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > DEFAULT_TIMEOUT
  )
    throw Error(GENERIC);

  const subscribe = options.rpc.subscribe!.bind(options.rpc);
  let active = false;
  let unusable = false;

  async function generate(input: GenerateInput): Promise<void> {
    if (unusable) throw Error(GENERIC);
    if (active) throw Error(ALREADY_RUNNING);
    active = true;
    let operation: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let unsubscribe: (() => void) | undefined;
    let threadId: string | undefined;
    let turnId: string | undefined;
    let turnRequested = false;
    let forceDispose = false;
    let disposed = false;
    let timedOut = false;
    let cancelled = false;
    let callbackFailed = false;
    let internalFailure = false;
    let turnEnded = false;
    let fatalError: unknown;
    let forwardAbort: (() => void) | undefined;

    const dispose = async () => {
      if (disposed) return;
      disposed = true;
      unusable = true;
      try {
        await options.dispose();
      } catch {
        // Provider diagnostics and cleanup failures stay private.
      }
    };

    const safetyCleanup = async () => {
      if (!turnRequested) return;
      if (turnEnded) {
        if (forceDispose || callbackFailed) await dispose();
        return;
      }
      if (!turnId) {
        await dispose();
        return;
      }
      const interrupted = await boundedInterrupt(
        options.rpc,
        threadId!,
        turnId,
      );
      if (!interrupted || forceDispose || callbackFailed) {
        await dispose();
        return;
      }
      // An interrupt acknowledgement is not proof that the remote turn has
      // stopped. Give its terminal notification a short chance to arrive;
      // otherwise retire this runtime so no inference can survive the call.
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
      if (!turnEnded) await dispose();
    };

    try {
      if (
        !input ||
        typeof input.model !== "string" ||
        typeof input.effort !== "string" ||
        typeof input.onText !== "function" ||
        !id(input.model) ||
        !text(input.effort, 32) ||
        !text(input.instructions, MAX_INSTRUCTIONS) ||
        !text(input.input, MAX_INPUT) ||
        input.instructions.length === 0 ||
        input.input.length === 0
      )
        throw INVALID_INPUT;
      if (input.signal?.aborted) {
        cancelled = true;
        throw ABORTED;
      }

      operation = new AbortController();
      forwardAbort = () => {
        cancelled = !timedOut;
        operation!.abort();
      };
      if (input.signal) {
        input.signal.addEventListener("abort", forwardAbort, { once: true });
        if (input.signal.aborted) forwardAbort();
      }
      timer = setTimeout(() => {
        timedOut = true;
        operation!.abort();
      }, timeoutMs);

      const catalog = await awaitAbort(
        Promise.resolve().then(() => options.models()),
        operation.signal,
      );
      if (!Array.isArray(catalog)) throw MODEL_UNAVAILABLE;
      if (!modelAvailable(catalog, input.model, input.effort))
        throw MODEL_UNAVAILABLE;

      const threadResponse = await rpcRequest(
        options.rpc,
        THREAD_START,
        {
          model: input.model,
          serviceTier: "default",
          ephemeral: true,
          approvalPolicy: "never",
          sandbox: "read-only",
          baseInstructions: input.instructions,
          config: CHATGPT_GENERATION_CONFIG,
        },
        operation.signal,
      );
      const thread = record(threadResponse)?.thread;
      if (!id(record(thread)?.id)) throw GENERIC;
      threadId = record(thread)!.id as string;
      if (operation.signal.aborted) throw ABORTED;

      let resolveTerminal!: () => void;
      let rejectTerminal!: (error: unknown) => void;
      let terminal: Terminal | undefined;
      let outputBytes = 0;
      let bufferedBytes = 0;
      let deltaCount = 0;
      const buffered: BufferedDelta[] = [];
      const terminals: Terminal[] = [];
      let eventSequence = 0;
      const terminalPromise = new Promise<void>((resolve, reject) => {
        resolveTerminal = resolve;
        rejectTerminal = reject;
      });
      void terminalPromise.catch(() => undefined);
      const fail = (error: unknown) => {
        if (fatalError || (terminal && turnEnded)) return;
        fatalError = error;
        internalFailure = true;
        if (error === GENERIC) forceDispose = true;
        rejectTerminal(error);
        operation!.abort();
      };
      const complete = (ok: boolean, eventId: string, sequence: number) => {
        if (turnId) {
          if (eventId && eventId !== turnId) return;
          if (terminal) return;
          terminal = { ok, turnId: eventId, sequence };
          turnEnded = true;
          if (ok) resolveTerminal();
          else rejectTerminal(GENERIC);
          return;
        }
        if (terminals.length >= 8) {
          forceDispose = true;
          fail(GENERIC);
          return;
        }
        terminals.push({ ok, turnId: eventId, sequence });
      };
      const deliver = (delta: BufferedDelta) => {
        if (delta.turnId && delta.turnId !== turnId) return;
        outputBytes += byteLength(delta.text);
        if (outputBytes > MAX_OUTPUT) {
          forceDispose = true;
          throw GENERIC;
        }
        try {
          input.onText(delta.text);
        } catch {
          callbackFailed = true;
          forceDispose = true;
          throw GENERIC;
        }
      };
      const listener = (notification: unknown) => {
        const envelope = record(notification);
        if (!envelope || typeof envelope.method !== "string") return;
        if (envelope.method === "orbsie/runtime/closed") {
          forceDispose = true;
          fail(GENERIC);
          return;
        }
        if (toolRequest(envelope.method, envelope.params)) {
          forceDispose = true;
          fail(GENERIC);
          return;
        }
        if (fatalError || terminal) return;
        const params = record(envelope.params);
        if (!params || params.threadId !== threadId) return;
        const currentTurnId = eventTurnId(params);
        if (turnId && currentTurnId && currentTurnId !== turnId) return;
        if (
          (envelope.method === "item/agentMessage/delta" ||
            envelope.method === "turn/completed") &&
          !currentTurnId
        ) {
          forceDispose = true;
          fail(GENERIC);
          return;
        }
        const sequence = ++eventSequence;
        if (envelope.method === "item/agentMessage/delta") {
          if (!text(params.delta, MAX_DELTA)) {
            forceDispose = true;
            fail(GENERIC);
            return;
          }
          if (++deltaCount > MAX_DELTAS) {
            forceDispose = true;
            fail(GENERIC);
            return;
          }
          const delta = {
            text: params.delta,
            turnId: currentTurnId!,
            sequence,
          };
          if (!turnId) {
            bufferedBytes += byteLength(delta.text);
            if (bufferedBytes > MAX_OUTPUT || buffered.length >= MAX_DELTAS) {
              forceDispose = true;
              fail(GENERIC);
              return;
            }
            buffered.push(delta);
            return;
          }
          try {
            deliver(delta);
          } catch {
            fail(GENERIC);
          }
          return;
        }
        if (envelope.method === "turn/completed") {
          const status = terminalStatus(params);
          if (status === undefined) {
            forceDispose = true;
            fail(GENERIC);
            return;
          }
          complete(status, currentTurnId!, sequence);
        }
      };
      unsubscribe = subscribe(listener) ?? undefined;
      if (typeof unsubscribe !== "function") throw GENERIC;

      turnRequested = true;
      const turnResponsePromise = rpcRequest(
        options.rpc,
        TURN_START,
        {
          threadId,
          model: input.model,
          effort: input.effort,
          serviceTier: "default",
          input: [{ type: "text", text: input.input }],
          sandboxPolicy: CHATGPT_READ_POLICY,
          approvalPolicy: "never",
        },
        operation.signal,
      );
      const turnResponse = await turnResponsePromise;
      const turn = record(turnResponse)?.turn;
      if (!id(record(turn)?.id)) throw GENERIC;
      turnId = record(turn)!.id as string;
      terminal = terminals.find((candidate) => candidate.turnId === turnId);
      if (terminal) turnEnded = true;
      for (const delta of buffered) {
        if (!terminal || delta.sequence < terminal.sequence) deliver(delta);
      }
      buffered.length = 0;
      bufferedBytes = 0;
      if (fatalError) throw fatalError;
      if (terminal) {
        if (!terminal.ok) throw GENERIC;
      } else {
        await awaitAbort(terminalPromise, operation.signal);
        const finalTerminal = terminal as Terminal | undefined;
        if (!finalTerminal || !finalTerminal.ok) throw GENERIC;
      }
    } catch (error) {
      if (
        (error === ABORTED || operation?.signal.aborted) &&
        !internalFailure
      ) {
        if (timedOut) timedOut = true;
        else cancelled = true;
      }
      await safetyCleanup();
      throw publicError(error, timedOut, cancelled);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      if (unsubscribe) {
        try {
          unsubscribe();
        } catch {
          // Cleanup errors are deliberately not provider diagnostics.
        }
      }
      if (input?.signal && forwardAbort)
        input.signal.removeEventListener("abort", forwardAbort);
      active = false;
    }
  }

  return { generate };
}
