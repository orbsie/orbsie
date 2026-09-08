import { z } from "zod";

/**
 * Small, data-only rules engine for project gameplay.
 *
 * Programs contain no executable code: every operation is represented by a
 * bounded discriminated-union value. `stepGameProgram` evaluates one event in
 * program order and returns the previous state object when the event has no
 * observable or timer-bookkeeping effect. Entity references are checked
 * separately against the current project with `validateGameProgramReferences`.
 */

export const GAME_PROGRAM_LIMITS = Object.freeze({
  maxVariables: 32,
  maxRules: 64,
  maxConditionsPerRule: 8,
  maxActionsPerRule: 8,
  maxPathPoints: 16,
  maxActionsPerStep: 256,
  maxTickDelta: 3600,
  maxTimerCatchupPerRule: 16,
  maxNumericValue: 1_000_000,
  maxElapsed: 1_000_000_000,
  maxTimerSeconds: 3600,
});

const numeric = z
  .number()
  .finite()
  .min(-GAME_PROGRAM_LIMITS.maxNumericValue)
  .max(GAME_PROGRAM_LIMITS.maxNumericValue);
const position = z.tuple([numeric, numeric, numeric]);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const entityId = z.string().regex(/^[\w-]{1,80}$/);
const ruleId = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/);

const dangerousVariableNames = new Set([
  "__proto__",
  "prototype",
  "constructor",
  "toString",
  "valueOf",
  "hasOwnProperty",
  "isPrototypeOf",
  "propertyIsEnumerable",
  "__defineGetter__",
  "__defineSetter__",
  "__lookupGetter__",
  "__lookupSetter__",
]);

const variableName = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_]{0,31}$/)
  .refine((name) => !dangerousVariableNames.has(name), {
    message: "Reserved variable name.",
  });

const inputAction = z.enum(["jump", "up", "down", "left", "right"]);
const comparison = z.enum(["eq", "ne", "lt", "lte", "gt", "gte"]);

export const gameProgramVariableSchema = z.object({
  name: variableName,
  initial: numeric,
});

export const gameProgramTriggerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("start") }),
  z.object({ type: z.literal("click"), entityId }),
  z.object({ type: z.literal("collision"), entityId }),
  z.object({ type: z.literal("collect"), entityId }),
  z.object({ type: z.literal("input"), action: inputAction }),
  z.object({
    type: z.literal("timer"),
    seconds: z.number().finite().gt(0).max(GAME_PROGRAM_LIMITS.maxTimerSeconds),
    repeat: z.boolean().default(false),
  }),
]);

const gameProgramConditionOperandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("variable"), name: variableName }),
  z.object({ type: z.literal("score") }),
]);

export const gameProgramConditionSchema = z.object({
  operand: gameProgramConditionOperandSchema,
  comparison,
  value: numeric,
});

export const gameProgramActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("set_variable"),
    name: variableName,
    value: numeric,
  }),
  z.object({
    type: z.literal("add_variable"),
    name: variableName,
    amount: numeric,
  }),
  z.object({ type: z.literal("add_score"), amount: numeric }),
  z.object({ type: z.literal("win") }),
  z.object({ type: z.literal("lose") }),
  z.object({ type: z.literal("reset") }),
  z.object({ type: z.literal("set_color"), entityId, color }),
  z.object({
    type: z.literal("set_visibility"),
    entityId,
    visible: z.boolean(),
  }),
  z.object({ type: z.literal("set_position"), entityId, position }),
  z.object({
    type: z.literal("move_path"),
    entityId,
    points: z.array(position).min(2).max(GAME_PROGRAM_LIMITS.maxPathPoints),
    duration: z
      .number()
      .finite()
      .gt(0)
      .max(GAME_PROGRAM_LIMITS.maxTimerSeconds),
    loop: z.boolean().default(false),
  }),
]);

export const gameProgramRuleSchema = z.object({
  id: ruleId,
  trigger: gameProgramTriggerSchema,
  conditions: z
    .array(gameProgramConditionSchema)
    .max(GAME_PROGRAM_LIMITS.maxConditionsPerRule)
    .default([]),
  actions: z
    .array(gameProgramActionSchema)
    .max(GAME_PROGRAM_LIMITS.maxActionsPerRule)
    .default([]),
});

export const gameProgramSchema = z
  .object({
    variables: z
      .array(gameProgramVariableSchema)
      .max(GAME_PROGRAM_LIMITS.maxVariables)
      .default([]),
    rules: z
      .array(gameProgramRuleSchema)
      .max(GAME_PROGRAM_LIMITS.maxRules)
      .default([]),
  })
  .superRefine((program, context) => {
    const variableNames = new Set<string>();
    for (const [index, variable] of program.variables.entries()) {
      if (variableNames.has(variable.name))
        context.addIssue({
          code: "custom",
          path: ["variables", index, "name"],
          message: "Variable names must be unique.",
        });
      variableNames.add(variable.name);
    }

    const ruleIds = new Set<string>();
    for (const [ruleIndex, rule] of program.rules.entries()) {
      if (ruleIds.has(rule.id))
        context.addIssue({
          code: "custom",
          path: ["rules", ruleIndex, "id"],
          message: "Rule IDs must be unique.",
        });
      ruleIds.add(rule.id);

      for (const [conditionIndex, condition] of rule.conditions.entries()) {
        if (
          condition.operand.type === "variable" &&
          !variableNames.has(condition.operand.name)
        )
          context.addIssue({
            code: "custom",
            path: ["rules", ruleIndex, "conditions", conditionIndex, "operand"],
            message: `Unknown variable: ${condition.operand.name}`,
          });
      }
      for (const [actionIndex, action] of rule.actions.entries()) {
        if (
          (action.type === "set_variable" || action.type === "add_variable") &&
          !variableNames.has(action.name)
        )
          context.addIssue({
            code: "custom",
            path: ["rules", ruleIndex, "actions", actionIndex, "name"],
            message: `Unknown variable: ${action.name}`,
          });
      }
    }
  });

export const gameProgramEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("start") }),
  z.object({ type: z.literal("click"), entityId }),
  z.object({ type: z.literal("collision"), entityId }),
  z.object({ type: z.literal("collect"), entityId }),
  z.object({ type: z.literal("input"), action: inputAction }),
  z.object({
    type: z.literal("tick"),
    delta: z.number().finite().min(0).max(GAME_PROGRAM_LIMITS.maxTickDelta),
  }),
]);

export type GameProgram = z.infer<typeof gameProgramSchema>;
export type GameProgramVariable = z.infer<typeof gameProgramVariableSchema>;
export type GameProgramTrigger = z.infer<typeof gameProgramTriggerSchema>;
export type GameProgramCondition = z.infer<typeof gameProgramConditionSchema>;
export type GameProgramAction = z.infer<typeof gameProgramActionSchema>;
export type GameProgramRule = z.infer<typeof gameProgramRuleSchema>;
export type GameProgramEvent = z.infer<typeof gameProgramEventSchema>;
export type GameProgramStatus = "playing" | "won" | "lost";
export type GameProgramVec3 = [number, number, number];
export type GameProgramEntityOverride = {
  color?: string;
  visible?: boolean;
  position?: GameProgramVec3;
};
export type GameProgramPathState = {
  points: readonly GameProgramVec3[];
  duration: number;
  loop: boolean;
  elapsed: number;
};
export type GameProgramState = {
  variables: Readonly<Record<string, number>>;
  score: number;
  status: GameProgramStatus;
  elapsed: number;
  resetCount: number;
  entityOverrides: Readonly<Record<string, GameProgramEntityOverride>>;
  firedRuleIds: readonly string[];
  timerElapsed: Readonly<Record<string, number>>;
  pathStates: Readonly<Record<string, GameProgramPathState>>;
};

// Project snapshots are immutable after they enter the runtime. Cache the
// normalized schema output by snapshot identity so a 60fps tick loop does not
// reparse the full rule tree on every frame. A changed project must provide a
// new program object, as the rest of the immutable store does.
const parsedProgramCache = new WeakMap<GameProgram, GameProgram>();

function parseProgram(program: GameProgram): GameProgram {
  const cached = parsedProgramCache.get(program);
  if (cached) return cached;
  const parsed = gameProgramSchema.parse(program);
  parsedProgramCache.set(program, parsed);
  return parsed;
}

function collectReferences(program: GameProgram) {
  const parsed = parseProgram(program);
  const entities: string[] = [];
  const variables: string[] = [];
  const seenEntities = new Set<string>();
  const seenVariables = new Set<string>();
  const addEntity = (id: string) => {
    if (!seenEntities.has(id)) {
      seenEntities.add(id);
      entities.push(id);
    }
  };
  const addVariable = (name: string) => {
    if (!seenVariables.has(name)) {
      seenVariables.add(name);
      variables.push(name);
    }
  };
  for (const rule of parsed.rules) {
    if (
      rule.trigger.type === "click" ||
      rule.trigger.type === "collision" ||
      rule.trigger.type === "collect"
    )
      addEntity(rule.trigger.entityId);
    for (const condition of rule.conditions)
      if (condition.operand.type === "variable")
        addVariable(condition.operand.name);
    for (const action of rule.actions) {
      if (action.type === "set_variable" || action.type === "add_variable")
        addVariable(action.name);
      if (
        action.type === "set_color" ||
        action.type === "set_visibility" ||
        action.type === "set_position" ||
        action.type === "move_path"
      )
        addEntity(action.entityId);
    }
  }
  return { entities, variables };
}

/** Return entity IDs in first-reference order for project validation. */
export function collectGameProgramEntityIds(program: GameProgram): string[] {
  return collectReferences(program).entities;
}

/** Return variable names used by conditions/actions in first-reference order. */
export function collectGameProgramVariableNames(
  program: GameProgram,
): string[] {
  return collectReferences(program).variables;
}

/**
 * Validate all entity references against the current project. This must be
 * rerun when entities are removed or replaced; a seed entity ID is valid while
 * it exists in the project, even if its geometry is still loading.
 */
export function validateGameProgramReferences(
  program: GameProgram,
  entityIds: Iterable<string>,
): void {
  const parsed = parseProgram(program);
  const known = new Set(entityIds);
  for (const id of collectGameProgramEntityIds(parsed))
    if (!known.has(id)) throw new Error(`Unknown game-program entity: ${id}`);
}

function initialTimerElapsed(program: GameProgram): Record<string, number> {
  const timers = createDictionary<number>();
  for (const rule of program.rules)
    if (rule.trigger.type === "timer") timers[rule.id] = 0;
  return timers;
}

function createDictionary<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

function copyDictionary<T>(
  source: Readonly<Record<string, T>>,
): Record<string, T> {
  return Object.assign(createDictionary<T>(), source);
}

/** Create an isolated runtime state; program edits do not mutate this state. */
export function createGameProgramState(program: GameProgram): GameProgramState {
  const parsed = parseProgram(program);
  const variables = createDictionary<number>();
  for (const variable of parsed.variables)
    variables[variable.name] = variable.initial;
  return {
    variables,
    score: 0,
    status: "playing",
    elapsed: 0,
    resetCount: 0,
    entityOverrides: createDictionary<GameProgramEntityOverride>(),
    firedRuleIds: [],
    timerElapsed: initialTimerElapsed(parsed),
    pathStates: createDictionary<GameProgramPathState>(),
  };
}

function compare(
  left: number,
  operator: GameProgramCondition["comparison"],
  right: number,
) {
  switch (operator) {
    case "eq":
      return left === right;
    case "ne":
      return left !== right;
    case "lt":
      return left < right;
    case "lte":
      return left <= right;
    case "gt":
      return left > right;
    case "gte":
      return left >= right;
  }
}

function clampNumeric(value: number): number {
  if (!Number.isFinite(value))
    throw new Error("Game-program numeric value must be finite.");
  return Math.max(
    -GAME_PROGRAM_LIMITS.maxNumericValue,
    Math.min(GAME_PROGRAM_LIMITS.maxNumericValue, value),
  );
}

function samePosition(
  left: readonly number[] | undefined,
  right: readonly number[] | undefined,
) {
  if (!left || !right) return left === right;
  return Boolean(
    left &&
    left.length === right.length &&
    left.every((value, index) => value === right[index]),
  );
}

function interpolatePath(path: GameProgramPathState): GameProgramVec3 {
  const progress = Math.max(0, Math.min(1, path.elapsed / path.duration));
  const scaled = progress * (path.points.length - 1);
  const segment = Math.min(path.points.length - 2, Math.floor(scaled));
  const amount = scaled - segment;
  const from = path.points[segment];
  const to = path.points[segment + 1];
  return [
    from[0] + (to[0] - from[0]) * amount,
    from[1] + (to[1] - from[1]) * amount,
    from[2] + (to[2] - from[2]) * amount,
  ];
}

function triggerMatches(trigger: GameProgramTrigger, event: GameProgramEvent) {
  if (event.type === "tick") return false;
  if (trigger.type !== event.type) return false;
  if (trigger.type === "start") return true;
  if (trigger.type === "input" && event.type === "input")
    return trigger.action === event.action;
  if (
    (trigger.type === "click" ||
      trigger.type === "collision" ||
      trigger.type === "collect") &&
    (event.type === "click" ||
      event.type === "collision" ||
      event.type === "collect")
  )
    return trigger.entityId === event.entityId;
  return false;
}

/**
 * Apply one deterministic event. Timer catch-up discards excess overdue
 * firings after the bounded per-rule limit, preventing a long suspended tab
 * from creating unbounded actions. `reset` clears runtime state and halts the
 * current event; it never recursively evaluates start rules.
 */
export function stepGameProgram(
  program: GameProgram,
  state: GameProgramState,
  event: GameProgramEvent,
): GameProgramState {
  const parsed = parseProgram(program);
  const parsedEvent = gameProgramEventSchema.parse(event);
  let variables: Record<string, number> | undefined;
  let score = state.score;
  let status = state.status;
  let elapsed = state.elapsed;
  let resetCount = state.resetCount ?? 0;
  let entityOverrides: Record<string, GameProgramEntityOverride> | undefined;
  let firedRuleIds: string[] | undefined;
  let timerElapsed: Record<string, number> | undefined;
  let pathStates: Record<string, GameProgramPathState> | undefined;
  let changed = false;
  let halted = false;
  let actionCount = 0;

  const currentVariables = () => variables ?? state.variables;
  const currentOverrides = () => entityOverrides ?? state.entityOverrides;
  const currentFired = () => firedRuleIds ?? state.firedRuleIds;
  const currentTimers = () => timerElapsed ?? state.timerElapsed;
  const currentPaths = () => pathStates ?? state.pathStates;
  const ensureVariables = () => (variables ??= copyDictionary(state.variables));
  const ensureOverrides = () =>
    (entityOverrides ??= copyDictionary(state.entityOverrides));
  const ensureFired = () => (firedRuleIds ??= [...state.firedRuleIds]);
  const ensureTimers = () =>
    (timerElapsed ??= copyDictionary(state.timerElapsed));
  const ensurePaths = () => (pathStates ??= copyDictionary(state.pathStates));

  const setVariable = (name: string, value: number) => {
    const bounded = clampNumeric(value);
    if (currentVariables()[name] === bounded) return;
    ensureVariables()[name] = bounded;
    changed = true;
  };
  const setScore = (value: number) => {
    const bounded = clampNumeric(value);
    if (score === bounded) return;
    score = bounded;
    changed = true;
  };
  const setOverride = (entityId: string, patch: GameProgramEntityOverride) => {
    const overrides = currentOverrides();
    const previous = Object.prototype.hasOwnProperty.call(overrides, entityId)
      ? overrides[entityId]
      : {};
    const next: GameProgramEntityOverride = { ...previous, ...patch };
    if (
      previous.color === next.color &&
      previous.visible === next.visible &&
      samePosition(previous.position, next.position)
    )
      return;
    ensureOverrides()[entityId] = next;
    changed = true;
  };
  const reset = () => {
    const initialVariables = createDictionary<number>();
    for (const variable of parsed.variables)
      initialVariables[variable.name] = variable.initial;
    variables = initialVariables;
    score = 0;
    status = "playing";
    elapsed = 0;
    resetCount = Math.min(Number.MAX_SAFE_INTEGER, resetCount + 1);
    entityOverrides = createDictionary<GameProgramEntityOverride>();
    firedRuleIds = [];
    timerElapsed = initialTimerElapsed(parsed);
    pathStates = createDictionary<GameProgramPathState>();
    changed = true;
    halted = true;
  };
  const conditionsPass = (rule: GameProgramRule) =>
    rule.conditions.every((condition) => {
      const left =
        condition.operand.type === "score"
          ? score
          : currentVariables()[condition.operand.name];
      return compare(left, condition.comparison, condition.value);
    });

  const applyAction = (action: GameProgramAction) => {
    if (halted && action.type !== "reset") return;
    if (status !== "playing" && action.type !== "reset") return;
    actionCount += 1;
    if (actionCount > GAME_PROGRAM_LIMITS.maxActionsPerStep)
      throw new Error("Game-program action budget exceeded.");
    switch (action.type) {
      case "set_variable":
        setVariable(action.name, action.value);
        break;
      case "add_variable":
        setVariable(
          action.name,
          (currentVariables()[action.name] ?? 0) + action.amount,
        );
        break;
      case "add_score":
        setScore(score + action.amount);
        break;
      case "win":
        if (status !== "won") {
          status = "won";
          changed = true;
        }
        break;
      case "lose":
        if (status !== "lost") {
          status = "lost";
          changed = true;
        }
        break;
      case "reset":
        reset();
        break;
      case "set_color":
        setOverride(action.entityId, { color: action.color });
        break;
      case "set_visibility":
        setOverride(action.entityId, { visible: action.visible });
        break;
      case "set_position":
        setOverride(action.entityId, { position: [...action.position] });
        if (
          Object.prototype.hasOwnProperty.call(currentPaths(), action.entityId)
        ) {
          delete ensurePaths()[action.entityId];
          changed = true;
        }
        break;
      case "move_path": {
        const path: GameProgramPathState = {
          points: action.points.map((point) => [...point] as GameProgramVec3),
          duration: action.duration,
          loop: action.loop,
          elapsed: 0,
        };
        ensurePaths()[action.entityId] = path;
        setOverride(action.entityId, { position: [...path.points[0]] });
        changed = true;
        break;
      }
    }
  };
  const applyRule = (rule: GameProgramRule) => {
    if (halted || !conditionsPass(rule)) return;
    for (const action of rule.actions) {
      applyAction(action);
      if (halted) break;
    }
  };
  const markFired = (ruleId: string) => {
    if (currentFired().includes(ruleId)) return false;
    ensureFired().push(ruleId);
    changed = true;
    return true;
  };

  if (parsedEvent.type === "tick") {
    const delta = parsedEvent.delta;
    if (delta > 0) {
      const nextElapsed = Math.min(
        GAME_PROGRAM_LIMITS.maxElapsed,
        elapsed + delta,
      );
      if (nextElapsed !== elapsed) {
        elapsed = nextElapsed;
        changed = true;
      }
      if (status === "playing") {
        for (const [entityId, path] of Object.entries(currentPaths())) {
          const nextElapsed = path.loop
            ? (path.elapsed + delta) % path.duration
            : Math.min(path.duration, path.elapsed + delta);
          const nextPath = { ...path, elapsed: nextElapsed };
          ensureOverrides();
          setOverride(entityId, { position: interpolatePath(nextPath) });
          if (path.loop || nextElapsed < path.duration)
            ensurePaths()[entityId] = nextPath;
          else delete ensurePaths()[entityId];
          changed = true;
        }

        for (const rule of parsed.rules) {
          if (halted || rule.trigger.type !== "timer") continue;
          const trigger = rule.trigger;
          const timers = currentTimers();
          const previousElapsed = Object.prototype.hasOwnProperty.call(
            timers,
            rule.id,
          )
            ? timers[rule.id]
            : 0;
          const total = previousElapsed + delta;
          // Treat a quotient within the same tolerance as an integer. Decimal
          // periods such as 0.1 otherwise make 0.3 / 0.1 evaluate to 2.999…
          // and silently discard a due firing.
          const due = Math.floor(total / trigger.seconds + 1e-9);
          if (due <= 0) {
            if (total !== previousElapsed) {
              ensureTimers()[rule.id] = total;
              changed = true;
            }
            continue;
          }
          const remainder = total % trigger.seconds;
          // Decimal timer periods can leave a nearly-full-period remainder
          // after an exact catch-up in binary floating point (for example,
          // 60 % 0.1). Keep the observable clock stable at the boundary.
          ensureTimers()[rule.id] =
            remainder < 1e-9 || trigger.seconds - remainder < 1e-9
              ? 0
              : remainder;
          changed = true;
          if (!trigger.repeat) {
            if (!markFired(rule.id)) continue;
            applyRule(rule);
            continue;
          }
          const firings = Math.min(
            due,
            GAME_PROGRAM_LIMITS.maxTimerCatchupPerRule,
          );
          for (let index = 0; index < firings && !halted; index += 1)
            applyRule(rule);
        }
      }
    }
  } else {
    for (const rule of parsed.rules) {
      if (!triggerMatches(rule.trigger, parsedEvent)) continue;
      if (rule.trigger.type === "start" && !markFired(rule.id)) continue;
      applyRule(rule);
      if (halted) break;
    }
  }

  if (!changed) return state;
  return {
    variables: variables ?? state.variables,
    score,
    status,
    elapsed,
    resetCount,
    entityOverrides: entityOverrides ?? state.entityOverrides,
    firedRuleIds: firedRuleIds ?? state.firedRuleIds,
    timerElapsed: timerElapsed ?? state.timerElapsed,
    pathStates: pathStates ?? state.pathStates,
  };
}
