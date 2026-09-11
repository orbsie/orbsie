export type Vec3 = readonly [number, number, number];

export type ParcelFrame = {
  normal: Vec3;
  east: Vec3;
  north: Vec3;
  spinPhase: number;
};

export type ParcelTransitionState = {
  progress: number;
  spin: number;
  target: 0 | 1;
  elapsed: number;
  uiElapsed: number;
  uiProgress: number;
  settled: boolean;
  from: number;
};

const TAU = Math.PI * 2;
const MAX_PLANET_SPIN = 0.08;
export const PARCEL_TRANSITION_SECONDS = 3.8;
export const COMPOSER_TRANSITION_SECONDS = 0.85;
export const PARCEL_SETTLE_THRESHOLD = 0.995;

function hashProjectId(value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function unit(value: Vec3): Vec3 {
  const length = Math.hypot(...value);
  return length > 0
    ? [value[0] / length, value[1] / length, value[2] / length]
    : [0, 1, 0];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

/** Return a stable surface point and right-handed tangent basis for a project. */
export function parcelFrame(projectId: string): ParcelFrame {
  const hash = hashProjectId(projectId);
  const latitude = ((hash & 0xffff) / 0xffff - 0.5) * 0.9;
  const longitude = (((hash >>> 16) & 0xffff) / 0xffff - 0.5) * TAU;
  const cosLatitude = Math.cos(latitude);
  const normal = unit([
    cosLatitude * Math.cos(longitude),
    Math.sin(latitude),
    cosLatitude * Math.sin(longitude),
  ]);
  const reference: Vec3 = Math.abs(normal[1]) > 0.92 ? [1, 0, 0] : [0, 1, 0];
  const east = unit(cross(reference, normal));
  const north = unit(cross(normal, east));
  return {
    normal,
    east,
    north,
    spinPhase: ((Math.imul(hash, 2654435761) >>> 0) / 0xffffffff) * TAU,
  };
}

export function clampProgress(value: number) {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

export function smoothTransition(value: number, start = 0, end = 1) {
  const range = Math.max(0.0001, end - start);
  const t = clampProgress((value - start) / range);
  return t * t * (3 - 2 * t);
}

export function patchBlend(progress: number) {
  return smoothTransition(progress, 0.18, 0.96);
}

export function globeScale(progress: number) {
  const value = clampProgress(progress);
  return 1 + value * value * 6;
}

export function globeOffsetY(progress: number) {
  const value = clampProgress(progress);
  return -value * 3 * globeScale(value);
}

export function planetSpinRate(progress: number, reducedMotion = false) {
  return reducedMotion ? 0 : MAX_PLANET_SPIN * (1 - clampProgress(progress));
}

export function createParcelTransition(progress = 0): ParcelTransitionState {
  const value = clampProgress(progress);
  const target: 0 | 1 = value >= 1 ? 1 : 0;
  return {
    progress: value,
    spin: 0,
    target,
    elapsed: target === value ? PARCEL_TRANSITION_SECONDS : 0,
    uiElapsed: target === 1 ? COMPOSER_TRANSITION_SECONDS : 0,
    uiProgress: target,
    settled: target === 1 ? value >= PARCEL_SETTLE_THRESHOLD : value <= 0,
    from: value,
  };
}

/**
 * Advance the shared camera/composer transition without tying it to network
 * progress. The duration is intentionally finite so the visual handoff and
 * UI arrival can be coordinated without a completion timer in the store.
 */
export function stepParcelTransition(
  state: ParcelTransitionState,
  target: 0 | 1,
  deltaSeconds: number,
  reducedMotion = false,
): ParcelTransitionState {
  const dt = Math.max(
    0,
    Math.min(0.1, Number.isFinite(deltaSeconds) ? deltaSeconds : 0),
  );
  const targetChanged = state.target !== target;
  const from = targetChanged ? state.progress : state.from;
  const elapsed = targetChanged
    ? Math.min(PARCEL_TRANSITION_SECONDS, dt)
    : Math.min(PARCEL_TRANSITION_SECONDS, state.elapsed + dt);
  const normalized =
    PARCEL_TRANSITION_SECONDS > 0 ? elapsed / PARCEL_TRANSITION_SECONDS : 1;
  const progress = reducedMotion
    ? target
    : from + (target - from) * smoothTransition(normalized);
  const uiElapsed = reducedMotion
    ? target === 1
      ? COMPOSER_TRANSITION_SECONDS
      : 0
    : Math.max(
        0,
        Math.min(
          COMPOSER_TRANSITION_SECONDS,
          targetChanged
            ? target === 1
              ? dt
              : COMPOSER_TRANSITION_SECONDS - dt
            : state.uiElapsed + (target === 1 ? dt : -dt),
        ),
      );
  const uiProgress =
    COMPOSER_TRANSITION_SECONDS > 0
      ? smoothTransition(uiElapsed / COMPOSER_TRANSITION_SECONDS)
      : target;
  return {
    progress: clampProgress(progress),
    spin: state.spin + dt * planetSpinRate(progress, reducedMotion),
    target,
    elapsed,
    uiElapsed,
    uiProgress,
    settled:
      target === 1
        ? progress >= PARCEL_SETTLE_THRESHOLD
        : progress <= 1 - PARCEL_SETTLE_THRESHOLD,
    from,
  };
}

type UiBox = { x: number; y: number; width: number; height: number };

/**
 * The mounted editor and renderer share this controller. The controller only
 * writes CSS properties on the composer during frames; it never schedules a
 * React/store update for animation progress.
 */
export class ParcelTransitionController {
  private state = createParcelTransition();
  private rendererAttachments = new Set<symbol>();
  private uiElement: HTMLElement | undefined;
  private uiFrom: UiBox | undefined;
  private uiTo: UiBox | undefined;
  private uiLast: UiBox | undefined;
  private uiLegProgress = 1;

  get snapshot() {
    return this.state;
  }

  get hasRenderer() {
    return this.rendererAttachments.size > 0;
  }

  attachRenderer() {
    const token = Symbol("renderer");
    this.rendererAttachments.add(token);
    let attached = true;
    return () => {
      if (attached) {
        attached = false;
        this.rendererAttachments.delete(token);
      }
    };
  }

  markRendererUnavailable() {
    this.rendererAttachments.clear();
  }

  reset(progress: 0 | 1) {
    this.state = createParcelTransition(progress);
    this.uiFrom = undefined;
    this.uiTo = undefined;
    this.uiLast = undefined;
    this.uiLegProgress = 1;
    this.clearUiStyles();
    this.refreshUi();
    this.applyUi();
  }

  setTarget(target: 0 | 1) {
    if (this.state.target === target) return;
    const current = this.currentUiBox();
    this.state = stepParcelTransition(this.state, target, 0);
    this.uiFrom = current;
    this.uiTo = undefined;
    this.uiLegProgress = 0;
    this.applyUi();
  }

  step(deltaSeconds: number, reducedMotion = false) {
    const frameSeconds = Number.isFinite(deltaSeconds)
      ? Math.min(0.1, Math.max(0, deltaSeconds))
      : 0;
    this.state = stepParcelTransition(
      this.state,
      this.state.target,
      frameSeconds,
      reducedMotion,
    );
    this.uiLegProgress = reducedMotion
      ? 1
      : Math.min(
          1,
          this.uiLegProgress + frameSeconds / COMPOSER_TRANSITION_SECONDS,
        );
    this.applyUi();
    return this.state;
  }

  /** Register the persistent composer element after React commits its class. */
  attachUi(element: HTMLElement | null) {
    this.uiElement = element ?? undefined;
    if (element) this.refreshUi();
    this.applyUi();
    let attached = true;
    return () => {
      if (attached) {
        attached = false;
        if (this.uiElement === element) this.uiElement = undefined;
      }
    };
  }

  /** Re-measure a responsive destination without disturbing active motion. */
  refreshUi() {
    const element = this.uiElement;
    if (!element || typeof window === "undefined") return;
    const destination = this.measureDestination(element);
    if (this.uiFrom && this.uiIsMoving()) {
      this.uiFrom = this.uiTo
        ? (this.currentUiBox() ?? this.uiFrom)
        : this.uiFrom;
      this.uiTo = destination;
      this.uiLegProgress = 0;
    } else {
      this.uiFrom = destination;
      this.uiTo = destination;
      this.uiLast = destination;
    }
    this.applyUi();
  }

  private measure(element: HTMLElement): UiBox {
    const rect = element.getBoundingClientRect();
    return {
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
    };
  }

  private measureDestination(element: HTMLElement): UiBox {
    const translate = element.style.getPropertyValue("translate");
    const width = element.style.getPropertyValue("width");
    element.style.removeProperty("translate");
    element.style.removeProperty("width");
    const destination = this.measure(element);
    if (translate) element.style.setProperty("translate", translate);
    if (width) element.style.setProperty("width", width);
    return destination;
  }

  private uiIsMoving() {
    return this.uiLegProgress < 1;
  }

  private clearUiStyles() {
    this.uiElement?.style.removeProperty("translate");
    this.uiElement?.style.removeProperty("width");
  }

  private currentUiBox() {
    if (!this.uiFrom || !this.uiTo) return this.uiLast;
    const progress = clampProgress(this.uiLegProgress);
    return {
      x: this.uiFrom.x + (this.uiTo.x - this.uiFrom.x) * progress,
      y: this.uiFrom.y + (this.uiTo.y - this.uiFrom.y) * progress,
      width:
        this.uiFrom.width + (this.uiTo.width - this.uiFrom.width) * progress,
      height:
        this.uiFrom.height + (this.uiTo.height - this.uiFrom.height) * progress,
    };
  }

  private applyUi() {
    const element = this.uiElement;
    if (!element || typeof window === "undefined") return;
    if (!this.uiTo || !this.uiFrom) return;
    const to = this.uiTo;
    const from = this.uiFrom ?? to;
    const progress = clampProgress(this.uiLegProgress);
    const box = {
      x: from.x + (to.x - from.x) * progress,
      y: from.y + (to.y - from.y) * progress,
      width: from.width + (to.width - from.width) * progress,
      height: from.height + (to.height - from.height) * progress,
    };
    const done = progress >= 1;
    if (done) {
      element.style.removeProperty("translate");
      element.style.removeProperty("width");
      this.uiLast = to;
      this.uiFrom = to;
      return;
    }
    // Keep the class-provided transform (landing centering, mobile sheet
    // position, and responsive overrides) and add only an independent pixel
    // translation. Width changes can alter percentage-based transforms, so
    // measure the clean base anchor at the interpolated width first.
    element.style.width = `${box.width}px`;
    element.style.removeProperty("translate");
    const base = this.measure(element);
    element.style.setProperty(
      "translate",
      `${box.x - base.x}px ${box.y - base.y}px`,
    );
  }
}

export const parcelTransitionController = new ParcelTransitionController();
