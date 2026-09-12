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

export class PlayerInputTracker {
  private readonly keyboardKeys = new Set<string>();
  private readonly pointerActions = new Map<
    number | string,
    GameSessionInput
  >();
  private readonly pressed: GameSessionInput[] = [];

  setKeyboard(key: string, down: boolean): void {
    const normalized = key.toLowerCase();
    const action = actionForPlayerKey(normalized);
    if (!action) return;
    if (down) {
      if (this.keyboardKeys.has(normalized)) return;
      const wasHeld = this.isHeld(action);
      this.keyboardKeys.add(normalized);
      if (!wasHeld && this.pressed.length < 64) this.pressed.push(action);
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
      if (!wasHeld && this.pressed.length < 64) this.pressed.push(action);
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
    return this.pressed.splice(0, 64);
  }

  clear(): void {
    this.keyboardKeys.clear();
    this.pointerActions.clear();
    this.pressed.length = 0;
  }
}
