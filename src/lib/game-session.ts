import type { Entity } from "./protocol";
import {
  createGameProgramState,
  gameProgramSchema,
  type GameProgram,
  type GameProgramEvent,
  type GameProgramState,
} from "./game-program";
import { stepGameProgram } from "./game-program";

export const GAME_SESSION_INPUTS = [
  "jump",
  "up",
  "down",
  "left",
  "right",
] as const;

export type GameSessionInput = (typeof GAME_SESSION_INPUTS)[number];

const MAX_QUEUED_CLICKS = 64;
const MAX_CONTACTS = 256;
const MAX_COLLECTIONS = 256;
const MAX_TICK_DELTA = 0.04;

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value))
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}

function copyVec3(value: readonly number[]): [number, number, number] {
  return [value[0], value[1], value[2]];
}

function sanitizeInputs(actions: readonly GameSessionInput[]) {
  const allowed = new Set<string>(GAME_SESSION_INPUTS);
  const next = new Set<GameSessionInput>();
  for (const action of actions) {
    if (allowed.has(action)) next.add(action);
  }
  return next;
}

/**
 * Owns one in-memory game-program run for a rendered scene.
 *
 * The store remains the source of project data. This bridge only owns the
 * short-lived event edges and deterministic engine state needed between
 * renders, so a project revision with an equivalent game program does not
 * reset a running scene.
 */
export class GameSession {
  private projectId: string | undefined;
  private sourceProgram: GameProgram | undefined;
  private program: GameProgram | undefined;
  private programSignature: string | undefined;
  private restartToken: number | undefined;
  private hasSynced = false;
  private currentState: GameProgramState | undefined;
  private currentError: Error | undefined;
  private stopped = false;
  private started = false;
  private heldInputs = new Set<GameSessionInput>();
  private contactIds = new Set<string>();
  private collectionIds = new Set<string>();
  private queuedClicks: string[] = [];
  private queuedInputs: GameSessionInput[] = [];
  private generation = 0;

  get state(): GameProgramState | undefined {
    return this.currentState;
  }

  get error(): Error | undefined {
    return this.currentError;
  }

  get resetGeneration(): number {
    return this.generation;
  }

  /** Connect the session to the current project snapshot. */
  sync(projectId: string, program: GameProgram | undefined, reset = 0): void {
    const restartChanged = this.restartToken !== reset;
    const projectChanged = this.projectId !== projectId;
    if (
      this.hasSynced &&
      this.sourceProgram === program &&
      !restartChanged &&
      !projectChanged
    )
      return;

    let parsedProgram: GameProgram | undefined;
    let signature: string;
    try {
      parsedProgram = program ? gameProgramSchema.parse(program) : undefined;
      signature = parsedProgram === undefined ? "" : stableJson(parsedProgram);
    } catch (error) {
      this.currentError = asError(error);
      this.stopped = true;
      return;
    }

    const programChanged = this.programSignature !== signature;
    const firstSync = !this.hasSynced;

    this.projectId = projectId;
    this.sourceProgram = program;
    this.restartToken = reset;
    this.program = parsedProgram;
    this.programSignature = signature;
    this.hasSynced = true;
    if (!firstSync && !restartChanged && !projectChanged && !programChanged)
      return;

    if (!firstSync) this.generation += 1;
    this.currentError = undefined;
    this.stopped = false;
    this.started = false;
    this.heldInputs.clear();
    this.contactIds.clear();
    this.collectionIds.clear();
    this.queuedClicks = [];
    this.queuedInputs = [];
    this.currentState = parsedProgram
      ? createGameProgramState(parsedProgram)
      : undefined;
  }

  /** Queue a bounded click edge for the next advance. */
  queueClick(entityId: string): void {
    if (this.queuedClicks.length >= MAX_QUEUED_CLICKS) return;
    this.queuedClicks.push(entityId);
  }

  /** Preserve discrete DOM input edges even when press/release occur between frames. */
  queueInput(action: GameSessionInput): void {
    if (this.queuedInputs.length < 64 && GAME_SESSION_INPUTS.includes(action))
      this.queuedInputs.push(action);
  }

  /**
   * Advance one render frame. Input is treated as a held set; only newly
   * pressed actions become engine events. Clicks are flushed after the tick.
   */
  advance(
    delta: number,
    actions: readonly GameSessionInput[] = [],
  ): GameProgramState | undefined {
    if (!this.program || !this.currentState || this.stopped)
      return this.currentState;

    const nextInputs = sanitizeInputs(actions);
    const pressed = [...nextInputs].filter(
      (action) => !this.heldInputs.has(action),
    );
    const generationBeforeStart = this.generation;
    if (!this.started) {
      this.started = true;
      this.applyEvent({ type: "start" });
      if (this.stopped || this.generation !== generationBeforeStart)
        return this.currentState;
    }

    this.heldInputs = nextInputs;
    for (const action of [...this.queuedInputs.splice(0, 64), ...pressed]) {
      this.applyEvent({ type: "input", action });
      if (this.stopped || !this.started) return this.currentState;
    }
    if (this.stopped) return this.currentState;

    const boundedDelta = Number.isFinite(delta)
      ? Math.min(MAX_TICK_DELTA, Math.max(0, delta))
      : 0;
    const generationBeforeTick = this.generation;
    this.applyEvent({ type: "tick", delta: boundedDelta });
    if (this.stopped || this.generation !== generationBeforeTick)
      return this.currentState;

    const clicks = this.queuedClicks.splice(0, MAX_QUEUED_CLICKS);
    for (const entityId of clicks) {
      this.applyEvent({ type: "click", entityId });
      if (this.stopped || !this.started) break;
    }
    return this.currentState;
  }

  /** Emit only collision edges for IDs that were not present last frame. */
  emitContacts(ids: Iterable<string>): GameProgramState | undefined {
    if (this.stopped || !this.program || !this.currentState)
      return this.currentState;
    const next = new Set<string>();
    for (const id of ids) {
      if (next.size >= MAX_CONTACTS) break;
      next.add(id);
    }
    for (const id of next) {
      if (!this.contactIds.has(id)) {
        const generationBefore = this.generation;
        this.applyEvent({ type: "collision", entityId: id });
        if (this.stopped) return this.currentState;
        if (this.generation !== generationBefore) return this.currentState;
      }
    }
    this.contactIds = next;
    return this.currentState;
  }

  /** Emit each collection ID at most once during this session. */
  emitCollections(ids: Iterable<string>): GameProgramState | undefined {
    if (this.stopped || !this.program || !this.currentState)
      return this.currentState;
    let emitted = 0;
    for (const id of ids) {
      if (emitted >= MAX_COLLECTIONS) break;
      if (this.collectionIds.has(id)) continue;
      const generationBefore = this.generation;
      this.applyEvent({ type: "collect", entityId: id });
      if (this.stopped) return this.currentState;
      if (this.generation !== generationBefore) return this.currentState;
      this.collectionIds.add(id);
      emitted += 1;
    }
    return this.currentState;
  }

  /** Apply program overrides for rendering and suppress legacy move motion. */
  effectiveEntity(entity: Entity): Entity | null {
    const override = this.currentState?.entityOverrides[entity.id];
    if (override?.visible === false) return null;
    if (!override) return entity;
    const hasPositionOverride = override.position !== undefined;
    return {
      ...entity,
      color: override.color ?? entity.color,
      position: override.position
        ? copyVec3(override.position)
        : entity.position,
      behavior:
        hasPositionOverride && entity.behavior?.type === "move"
          ? undefined
          : entity.behavior,
    };
  }

  private applyEvent(event: GameProgramEvent): void {
    if (this.stopped || !this.program || !this.currentState) return;
    const previous = this.currentState;
    try {
      const next = stepGameProgram(this.program, previous, event);
      this.currentState = next;
      if (next.resetCount !== previous.resetCount) this.handleEngineReset();
    } catch (error) {
      this.currentError = asError(error);
      this.stopped = true;
      this.currentState = previous;
    }
  }

  private handleEngineReset(): void {
    this.generation += 1;
    this.started = false;
    this.heldInputs.clear();
    this.contactIds.clear();
    this.collectionIds.clear();
    this.queuedClicks = [];
    this.queuedInputs = [];
  }
}
