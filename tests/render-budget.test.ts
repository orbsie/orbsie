import { describe, expect, it } from "vitest";
import { maximumRenderDpr, RenderBudget } from "../src/lib/render-budget";

function frames(budget: RenderBudget, fps: number, seconds: number) {
  const changes: number[] = [];
  for (let i = 0; i < fps * seconds; i++) {
    const change = budget.sample(1 / fps);
    if (change !== undefined) changes.push(change);
  }
  return changes;
}

describe("adaptive rendering budget", () => {
  it("keeps normal density on small screens and caps large backing buffers", () => {
    expect(maximumRenderDpr(390, 844, 3)).toBe(1.5);
    expect(maximumRenderDpr(1440, 1000, 1)).toBe(1);
    for (const [width, height] of [
      [1920, 1080],
      [3840, 2160],
    ]) {
      const large = maximumRenderDpr(width, height, 2);
      expect(width * height * large * large).toBeCloseTo(2_500_000);
    }
  });
  it("ignores startup and isolated slow frames, then reduces sustained load", () => {
    const budget = new RenderBudget(1.5);
    expect(frames(budget, 20, 2)).toEqual([]);
    budget.sample(0.1);
    expect(frames(budget, 60, 4)).toEqual([]);
    expect(frames(budget, 20, 6)).toContain(1.25);
  });
  it("bounds degraded resolution and recovers only after sustained fast frames", () => {
    const budget = new RenderBudget(1.5);
    frames(budget, 20, 30);
    expect(budget.dpr).toBe(0.75);
    expect(frames(budget, 60, 8)).toEqual([]);
    expect(frames(budget, 60, 6)).toEqual([1]);
    frames(budget, 60, 60);
    expect(budget.dpr).toBe(1.5);
  });
  it("does not increase a large-screen cap when lowering quality", () => {
    const budget = new RenderBudget(0.55);
    frames(budget, 20, 30);
    expect(budget.dpr).toBe(0.55);
  });
  it("responds even when a visible device can only render four frames per second", () => {
    const budget = new RenderBudget(1);
    frames(budget, 4, 8);
    expect(budget.dpr).toBe(0.75);
  });
  it("discards hidden-tab pauses instead of interpreting them as GPU load", () => {
    const budget = new RenderBudget(1);
    frames(budget, 60, 3);
    for (let i = 0; i < 100; i++) budget.sample(1, false);
    expect(frames(budget, 60, 10)).toEqual([]);
    expect(budget.dpr).toBe(1);
  });
});
