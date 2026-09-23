import {
  WORLD_NAVIGATION_CAMERA_ELEVATION_RADIANS,
  WORLD_NAVIGATION_LIMITS,
  type WorldNavigationCommand,
  type WorldNavigationVec2,
} from "./world-navigation";

export type NavigationPointerType = "mouse" | "touch";
export type NavigationPointerButton = "primary" | "secondary" | "other";

export type NavigationViewport = Readonly<{
  width: number;
  height: number;
  verticalFovRadians: number;
  distance: number;
  heading: number;
}>;

export type NavigationPointerDown = Readonly<{
  pointerId: number;
  pointerType: NavigationPointerType;
  x: number;
  y: number;
  /** Ignored for touch; only primary and secondary mouse buttons navigate. */
  button?: NavigationPointerButton;
  /** True when the adapter's hit test found a manipulable scene object. */
  objectHit?: boolean;
}>;

export type NavigationPointerPosition = Readonly<{
  pointerId: number;
  x: number;
  y: number;
}>;

export type NavigationWheelInput = Readonly<{ deltaY: number }>;

export type NavigationGestureResult = Readonly<{
  commands: readonly WorldNavigationCommand[];
  /** The input belongs to a recognized navigation gesture. */
  handled: boolean;
  /** Keep true through pointer-up so the adapter can suppress its later click. */
  suppressClick: boolean;
}>;

type Point = { x: number; y: number };
type ActivePointer = {
  pointerId: number;
  pointerType: NavigationPointerType;
  button: NavigationPointerButton;
  blocked: boolean;
  start: Point;
  last: Point;
  current: Point;
  recognized: boolean;
};
type PinchGesture = {
  pointerIds: readonly [number, number];
  previousDistance?: number;
  recognized: boolean;
};

const DRAG_THRESHOLD_PX = 6;
const PINCH_START_DISTANCE_PX = 8;
const PINCH_THRESHOLD_PX = 3;
const MIN_PINCH_DISTANCE_PX = 1;
const WHEEL_EXPONENT_LIMIT = 3;
const EMPTY_RESULT: NavigationGestureResult = {
  commands: [],
  handled: false,
  suppressClick: false,
};

function pointDistance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function validPointerId(pointerId: number) {
  return Number.isInteger(pointerId) && pointerId >= 0;
}

function validPoint(x: number, y: number) {
  return Number.isFinite(x) && Number.isFinite(y);
}

function validViewport(viewport: NavigationViewport) {
  return (
    Number.isFinite(viewport.width) &&
    viewport.width >= 1 &&
    Number.isFinite(viewport.height) &&
    viewport.height >= 1 &&
    Number.isFinite(viewport.verticalFovRadians) &&
    viewport.verticalFovRadians > 0 &&
    viewport.verticalFovRadians < Math.PI &&
    Number.isFinite(viewport.distance) &&
    viewport.distance > 0 &&
    Number.isFinite(viewport.heading)
  );
}

function normalizedHeading(heading: number) {
  const fullTurn = Math.PI * 2;
  const normalized = ((heading % fullTurn) + fullTurn) % fullTurn;
  return Object.is(normalized, -0) ? 0 : normalized;
}

function result(
  commands: readonly WorldNavigationCommand[],
  handled: boolean,
  suppressClick: boolean,
): NavigationGestureResult {
  return { commands, handled, suppressClick };
}

/**
 * Deterministic adapter-facing input recognizer. It only consumes normalized
 * pointer coordinates and camera projection values; DOM events, hit tests,
 * stores, and cameras remain the renderer adapter's responsibility.
 */
export class WorldNavigationGestureController {
  private readonly pointers = new Map<number, ActivePointer>();
  private readonly suppressedClicks = new Set<number>();
  private pinch?: PinchGesture;

  pointerDown(input: NavigationPointerDown): NavigationGestureResult {
    if (
      !validPointerId(input.pointerId) ||
      !validPoint(input.x, input.y) ||
      (input.pointerType !== "mouse" && input.pointerType !== "touch")
    )
      return EMPTY_RESULT;

    this.suppressedClicks.delete(input.pointerId);
    const button = input.pointerType === "touch" ? "primary" : input.button;
    this.pointers.set(input.pointerId, {
      pointerId: input.pointerId,
      pointerType: input.pointerType,
      button: button ?? "other",
      blocked:
        input.objectHit === true ||
        (input.pointerType === "mouse" &&
          button !== "primary" &&
          button !== "secondary"),
      start: { x: input.x, y: input.y },
      last: { x: input.x, y: input.y },
      current: { x: input.x, y: input.y },
      recognized: false,
    });
    if (input.pointerType === "touch") this.resetTouchGesture();
    return EMPTY_RESULT;
  }

  pointerMove(
    input: NavigationPointerPosition,
    viewport: NavigationViewport,
  ): NavigationGestureResult {
    if (!validPointerId(input.pointerId) || !validPoint(input.x, input.y))
      return EMPTY_RESULT;
    const pointer = this.pointers.get(input.pointerId);
    if (!pointer || !validViewport(viewport)) return EMPTY_RESULT;

    const next = { x: input.x, y: input.y };
    const movement = [
      next.x - pointer.last.x,
      next.y - pointer.last.y,
      next.x - pointer.start.x,
      next.y - pointer.start.y,
    ];
    if (!movement.every(Number.isFinite)) return EMPTY_RESULT;
    pointer.current = next;
    if (pointer.pointerType === "touch")
      return this.moveTouch(pointer, viewport);
    if (pointer.blocked) return EMPTY_RESULT;

    const dx = pointer.current.x - pointer.last.x;
    const dy = pointer.current.y - pointer.last.y;
    const totalX = pointer.current.x - pointer.start.x;
    const totalY = pointer.current.y - pointer.start.y;
    const isRotation = pointer.button === "secondary";
    const crossedThreshold = isRotation
      ? Math.abs(totalX) >= DRAG_THRESHOLD_PX
      : Math.hypot(totalX, totalY) >= DRAG_THRESHOLD_PX;
    if (!pointer.recognized && !crossedThreshold) return EMPTY_RESULT;
    pointer.last = pointer.current;
    if (!pointer.recognized) pointer.recognized = true;
    this.suppressedClicks.add(pointer.pointerId);

    if (pointer.button === "primary") {
      const delta = worldPanDelta(dx, dy, viewport);
      if (!delta) return result([], true, true);
      return result([{ type: "pan", delta }], true, true);
    }
    if (pointer.button === "secondary") {
      const heading = viewport.heading + (dx / viewport.width) * Math.PI * 2;
      if (!Number.isFinite(heading)) return result([], true, true);
      return result(
        [{ type: "rotate_to_heading", heading: normalizedHeading(heading) }],
        true,
        true,
      );
    }
    return EMPTY_RESULT;
  }

  pointerUp(pointerId: number): NavigationGestureResult {
    const pointer = this.pointers.get(pointerId);
    if (!pointer)
      return result([], false, this.suppressedClicks.has(pointerId));
    const suppressClick = this.suppressedClicks.has(pointerId);
    const handled =
      pointer.recognized ||
      suppressClick ||
      (this.pinch?.pointerIds.includes(pointerId) === true &&
        this.pinch.recognized);
    this.pointers.delete(pointerId);
    if (pointer.pointerType === "touch") this.resetTouchGesture();
    return result([], handled, suppressClick);
  }

  /** A cancelled gesture and its pending click suppression are discarded. */
  pointerCancel(pointerId: number): NavigationGestureResult {
    const pointer = this.pointers.get(pointerId);
    if (!pointer) return EMPTY_RESULT;
    const hadGesture =
      pointer.recognized ||
      this.suppressedClicks.has(pointerId) ||
      (this.pinch?.pointerIds.includes(pointerId) === true &&
        this.pinch.recognized);
    this.pointers.delete(pointerId);
    this.suppressedClicks.delete(pointerId);
    if (pointer.pointerType === "touch") this.resetTouchGesture();
    return result([], hadGesture, false);
  }

  wheel(
    input: NavigationWheelInput,
    viewport: NavigationViewport,
  ): NavigationGestureResult {
    if (!Number.isFinite(input.deltaY) || !validViewport(viewport))
      return EMPTY_RESULT;
    const normalizedDelta = Math.max(
      -WHEEL_EXPONENT_LIMIT,
      Math.min(WHEEL_EXPONENT_LIMIT, input.deltaY / viewport.height),
    );
    const factor = Math.exp(normalizedDelta * 0.9);
    if (!Number.isFinite(factor) || factor <= 0) return EMPTY_RESULT;
    return result([{ type: "zoom", factor }], true, false);
  }

  /** Consume a matching click suppression after the adapter observes click. */
  consumeClickSuppression(pointerId: number): boolean {
    return this.suppressedClicks.delete(pointerId);
  }

  blur(): void {
    this.clear();
  }

  reset(): void {
    this.clear();
  }

  private moveTouch(
    pointer: ActivePointer,
    viewport: NavigationViewport,
  ): NavigationGestureResult {
    const touchPointers = [...this.pointers.values()].filter(
      (candidate) => candidate.pointerType === "touch",
    );
    if (
      touchPointers.length === 2 &&
      !touchPointers.some((item) => item.blocked)
    ) {
      return this.movePinch(touchPointers);
    }
    this.pinch = undefined;
    if (touchPointers.length !== 1 || pointer.blocked) return EMPTY_RESULT;

    const dx = pointer.current.x - pointer.last.x;
    const dy = pointer.current.y - pointer.last.y;
    const totalX = pointer.current.x - pointer.start.x;
    const totalY = pointer.current.y - pointer.start.y;
    if (!pointer.recognized && Math.hypot(totalX, totalY) < DRAG_THRESHOLD_PX)
      return EMPTY_RESULT;
    pointer.last = pointer.current;
    pointer.recognized = true;
    this.suppressedClicks.add(pointer.pointerId);
    const delta = worldPanDelta(dx, dy, viewport);
    if (!delta) return result([], true, true);
    return result([{ type: "pan", delta }], true, true);
  }

  private movePinch(pointers: ActivePointer[]): NavigationGestureResult {
    const ordered = [...pointers].sort((a, b) => a.pointerId - b.pointerId);
    const first = ordered[0];
    const second = ordered[1];
    const ids = [first.pointerId, second.pointerId] as const;
    if (
      !this.pinch ||
      this.pinch.pointerIds[0] !== ids[0] ||
      this.pinch.pointerIds[1] !== ids[1]
    ) {
      this.pinch = { pointerIds: ids, recognized: false };
    }

    const distance = pointDistance(first.current, second.current);
    if (!Number.isFinite(distance) || distance < MIN_PINCH_DISTANCE_PX)
      return EMPTY_RESULT;
    if (this.pinch.previousDistance === undefined) {
      if (distance >= PINCH_START_DISTANCE_PX)
        this.pinch.previousDistance = distance;
      return EMPTY_RESULT;
    }

    const difference = distance - this.pinch.previousDistance;
    if (!this.pinch.recognized && Math.abs(difference) < PINCH_THRESHOLD_PX)
      return EMPTY_RESULT;
    if (difference === 0) return EMPTY_RESULT;
    const factor = this.pinch.previousDistance / distance;
    this.pinch.previousDistance = distance;
    if (!Number.isFinite(factor) || factor <= 0) return EMPTY_RESULT;
    this.pinch.recognized = true;
    for (const id of ids) this.suppressedClicks.add(id);
    return result([{ type: "zoom", factor }], true, true);
  }

  private resetTouchGesture() {
    const touches = [...this.pointers.values()].filter(
      (pointer) => pointer.pointerType === "touch",
    );
    for (const pointer of touches) {
      pointer.start = { ...pointer.current };
      pointer.last = { ...pointer.current };
      pointer.recognized = false;
    }
    this.pinch = undefined;
    if (touches.length !== 2 || touches.some((pointer) => pointer.blocked))
      return;
    const ordered = [...touches].sort((a, b) => a.pointerId - b.pointerId);
    const distance = pointDistance(ordered[0].current, ordered[1].current);
    this.pinch = {
      pointerIds: [ordered[0].pointerId, ordered[1].pointerId],
      previousDistance:
        Number.isFinite(distance) && distance >= PINCH_START_DISTANCE_PX
          ? distance
          : undefined,
      recognized: false,
    };
  }

  private clear() {
    this.pointers.clear();
    this.suppressedClicks.clear();
    this.pinch = undefined;
  }
}

function worldPanDelta(
  dx: number,
  dy: number,
  viewport: NavigationViewport,
): WorldNavigationVec2 | undefined {
  const verticalWorldSpan =
    2 * viewport.distance * Math.tan(viewport.verticalFovRadians / 2);
  const horizontalWorldSpan =
    verticalWorldSpan * (viewport.width / viewport.height);
  const horizontalMetersPerPixel = horizontalWorldSpan / viewport.width;
  const verticalMetersPerPixel =
    verticalWorldSpan /
    viewport.height /
    Math.sin(WORLD_NAVIGATION_CAMERA_ELEVATION_RADIANS);
  const heading = normalizedHeading(viewport.heading);
  const rightX = Math.cos(heading);
  const rightZ = -Math.sin(heading);
  const upX = Math.sin(heading);
  const upZ = -Math.cos(heading);
  const delta: readonly [number, number] = [
    -dx * horizontalMetersPerPixel * rightX + dy * verticalMetersPerPixel * upX,
    -dx * horizontalMetersPerPixel * rightZ + dy * verticalMetersPerPixel * upZ,
  ];
  if (!delta.every(Number.isFinite)) return undefined;
  const limit = WORLD_NAVIGATION_LIMITS.maxTargetCoordinate;
  return [
    Math.max(-limit, Math.min(limit, delta[0])),
    Math.max(-limit, Math.min(limit, delta[1])),
  ];
}
