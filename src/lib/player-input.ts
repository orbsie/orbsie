import type { GameSessionInput } from "./game-session";

const ACTIONS_BY_KEY: Record<string, GameSessionInput> = {
  w: "up",
  arrowup: "up",
  s: "down",
  arrowdown: "down",
  a: "left",
  arrowleft: "left",
  d: "right",
  arrowright: "right",
  " ": "jump",
};

export function actionForPlayerKey(key: string): GameSessionInput | undefined {
  return ACTIONS_BY_KEY[key.toLowerCase()];
}

export type PlayerInputDetail = {
  key: string;
  down: boolean;
  pointerId?: number;
};

export function dispatchPlayerPointerInput(
  key: string,
  down: boolean,
  pointerId: number,
): void {
  window.dispatchEvent(
    new CustomEvent<PlayerInputDetail>("orbsie-input", {
      detail: { key, down, pointerId },
    }),
  );
}

export function beginPlayerPointerInput(
  event: {
    currentTarget: { setPointerCapture(pointerId: number): void };
    pointerId: number;
  },
  key: string,
): void {
  event.currentTarget.setPointerCapture(event.pointerId);
  dispatchPlayerPointerInput(key, true, event.pointerId);
}

export function endPlayerPointerInput(
  event: { pointerId: number },
  key: string,
): void {
  dispatchPlayerPointerInput(key, false, event.pointerId);
}

const MAX_LATENCY_SAMPLES = 128;

export type PlayerInputTrackerOptions = {
  /** Enable opt-in simulation-consumption latency samples. */
  latencyTelemetry?: boolean;
  /** Monotonic clock used for acceptance and consumption timestamps. */
  clock?: () => number;
};

export type PlayerInputLatencySnapshot = {
  /** Accepted press to consumePressed simulation-boundary samples in ms. */
  sampleCount: number;
  samplesMs: number[];
};

function defaultMonotonicClock(): number {
  const clock = globalThis.performance?.now;
  return typeof clock === "function" ? clock.call(globalThis.performance) : NaN;
}

export class PlayerInputTracker {
  private readonly keyboardKeys = new Set<string>();
  private readonly pointerActions = new Map<
    number | string,
    GameSessionInput
  >();
  private readonly pressed: GameSessionInput[] = [];
  private readonly pendingPressTimes: (number | undefined)[] = [];
  private readonly latencySamples: number[] = [];
  private readonly latencyTelemetry: boolean;
  private readonly clock: () => number;
  private lastClockTime: number | undefined;

  constructor(options: PlayerInputTrackerOptions = {}) {
    this.latencyTelemetry = options.latencyTelemetry === true;
    this.clock = options.clock ?? defaultMonotonicClock;
  }

  getLatencySnapshot(): PlayerInputLatencySnapshot {
    return {
      sampleCount: this.latencySamples.length,
      samplesMs: [...this.latencySamples],
    };
  }

  private queuePressed(action: GameSessionInput): void {
    if (this.pressed.length >= 64) return;
    this.pressed.push(action);
    if (this.latencyTelemetry) this.pendingPressTimes.push(this.readClock());
  }

  private readClock(): number | undefined {
    const value = this.clock();
    if (
      !Number.isFinite(value) ||
      (this.lastClockTime !== undefined && value < this.lastClockTime)
    ) {
      // Do not turn an unavailable or regressing clock into a fake zero sample.
      return undefined;
    }
    this.lastClockTime = value;
    return value;
  }

  setKeyboard(key: string, down: boolean): void {
    const normalized = key.toLowerCase();
    const action = actionForPlayerKey(normalized);
    if (!action) return;
    if (down) {
      if (this.keyboardKeys.has(normalized)) return;
      const wasHeld = this.isHeld(action);
      this.keyboardKeys.add(normalized);
      if (!wasHeld) this.queuePressed(action);
    } else this.keyboardKeys.delete(normalized);
  }

  setPointer(pointerId: number | string, key: string, down: boolean): void {
    if (typeof pointerId === "number" && !Number.isInteger(pointerId)) return;
    const action = actionForPlayerKey(key);
    if (!action) return;
    if (down) {
      const previous = this.pointerActions.get(pointerId);
      if (previous === action) return;
      if (previous !== undefined) this.pointerActions.delete(pointerId);
      const wasHeld = this.isHeld(action);
      this.pointerActions.set(pointerId, action);
      if (!wasHeld) this.queuePressed(action);
      return;
    }
    if (this.pointerActions.get(pointerId) === action)
      this.pointerActions.delete(pointerId);
  }

  isHeld(action: GameSessionInput): boolean {
    return (
      [...this.keyboardKeys].some(
        (key) => actionForPlayerKey(key) === action,
      ) || [...this.pointerActions.values()].includes(action)
    );
  }

  consumePressed(): GameSessionInput[] {
    const consumed = this.pressed.splice(0, 64);
    if (!this.latencyTelemetry || consumed.length === 0) return consumed;

    const acceptedAt = this.pendingPressTimes.splice(0, consumed.length);
    const consumedAt = this.readClock();
    for (const accepted of acceptedAt) {
      if (accepted === undefined || consumedAt === undefined) continue;
      const latencyMs = consumedAt - accepted;
      if (latencyMs < 0) continue;
      this.latencySamples.push(latencyMs);
      if (this.latencySamples.length > MAX_LATENCY_SAMPLES)
        this.latencySamples.shift();
    }
    return consumed;
  }

  clear(): void {
    this.keyboardKeys.clear();
    this.pointerActions.clear();
    this.pressed.length = 0;
    this.pendingPressTimes.length = 0;
  }
}
