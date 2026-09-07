// Bound fill rate on large/high-density screens without changing world geometry.
export function maximumRenderDpr(
  width: number,
  height: number,
  deviceDpr: number,
) {
  return Math.min(
    deviceDpr,
    1.5,
    Math.sqrt(2_500_000 / Math.max(1, width * height)),
  );
}

// Slow frames must persist across two windows; recovery needs six fast windows.
// Returning only actual changes avoids React work in the frame loop.
export class RenderBudget {
  dpr: number;
  private elapsed = 0;
  private frames = 0;
  private slowWindows = 0;
  private fastWindows = 0;
  private warming = true;
  constructor(readonly maximum: number) {
    this.dpr = maximum;
  }
  sample(delta: number, visible = true): number | undefined {
    if (!visible || !Number.isFinite(delta) || delta <= 0 || delta > 1) {
      this.elapsed = this.frames = this.slowWindows = this.fastWindows = 0;
      return;
    }
    this.elapsed += delta;
    this.frames++;
    if (this.elapsed < 2) return;
    const average = this.elapsed / this.frames;
    this.elapsed = this.frames = 0;
    if (this.warming) {
      this.warming = false;
      return;
    }
    this.slowWindows = average > 1 / 38 ? this.slowWindows + 1 : 0;
    this.fastWindows = average < 1 / 55 ? this.fastWindows + 1 : 0;
    const next =
      this.slowWindows >= 2
        ? Math.max(Math.min(0.75, this.maximum), this.dpr - 0.25)
        : this.fastWindows >= 6
          ? Math.min(this.maximum, this.dpr + 0.25)
          : this.dpr;
    if (next === this.dpr) return;
    this.slowWindows = this.fastWindows = 0;
    this.dpr = next;
    return next;
  }
}
