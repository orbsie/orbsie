import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { ParcelTransitionController } from "../src/lib/parcel-transition";

type Mode = "landing" | "workspace";

function fakeComposer() {
  let mode: Mode = "landing";
  let workspace = { left: 20, top: 88, width: 342, height: 600 };
  const values = new Map<string, string>();
  const style = {
    getPropertyValue: (name: string) => values.get(name) ?? "",
    removeProperty: (name: string) => {
      values.delete(name);
    },
    setProperty: (name: string, value: string) => {
      values.set(name, value);
    },
    get transform() {
      return values.get("transform") ?? "";
    },
    set transform(value: string) {
      values.set("transform", value);
    },
    get width() {
      return values.get("width") ?? "";
    },
    set width(value: string) {
      values.set("width", value);
    },
    get translate() {
      return values.get("translate") ?? "";
    },
    set translate(value: string) {
      values.set("translate", value);
    },
  };
  const base = () =>
    (() => {
      const widthValue = Number.parseFloat(values.get("width") ?? "");
      const width = Number.isFinite(widthValue)
        ? widthValue
        : mode === "landing"
          ? 500
          : workspace.width;
      return mode === "landing"
        ? { left: 500 - width / 2, top: 300, width, height: 200 }
        : { ...workspace, width };
    })();
  const element = {
    style,
    getBoundingClientRect: () => {
      const box = base();
      const translate = values.get("translate") ?? "";
      const match = translate.match(/([-\d.]+)px\s+([-\d.]+)px/);
      return {
        left: box.left + (match ? Number(match[1]) : 0),
        top: box.top + (match ? Number(match[2]) : 0),
        width: box.width,
        height: box.height,
        right: box.left + box.width,
        bottom: box.top + box.height,
        x: box.left,
        y: box.top,
        toJSON: () => ({}),
      };
    },
    setMode(next: Mode) {
      mode = next;
    },
    setWorkspace(next: typeof workspace) {
      workspace = next;
    },
  } as unknown as HTMLElement & {
    setMode: (next: Mode) => void;
    setWorkspace: (next: typeof workspace) => void;
  };
  return element;
}

describe("parcel transition controller", () => {
  const originalWindow = globalThis.window;

  beforeEach(() => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { innerWidth: 1000, innerHeight: 800 },
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
  });

  it("opens a direct workspace at its settled destination", () => {
    const controller = new ParcelTransitionController();
    const composer = fakeComposer();
    composer.setMode("workspace");
    controller.reset(1);
    controller.attachUi(composer);
    expect(composer.style.getPropertyValue("translate")).toBe("");
    expect(composer.style.getPropertyValue("width")).toBe("");
  });

  it("measures a clean destination and preserves the current visual box on reverse", () => {
    const controller = new ParcelTransitionController();
    const composer = fakeComposer();
    controller.reset(0);
    controller.attachUi(composer);
    composer.setMode("workspace");
    controller.setTarget(1);
    controller.attachUi(composer);
    controller.step(0.1);
    const beforeResize = composer.getBoundingClientRect();
    expect(beforeResize.left).toBeGreaterThan(20);
    expect(beforeResize.left).toBeLessThan(250);
    expect(beforeResize.width).toBeGreaterThan(342);
    expect(beforeResize.width).toBeLessThan(500);

    composer.setWorkspace({ left: 40, top: 100, width: 400, height: 600 });
    controller.refreshUi();
    const afterResize = composer.getBoundingClientRect();
    expect(afterResize.left).toBeCloseTo(beforeResize.left, 6);
    expect(afterResize.width).toBeCloseTo(beforeResize.width, 6);
    controller.step(0.1);
    const afterResizeStep = composer.getBoundingClientRect();
    expect(afterResizeStep.left).toBeLessThan(afterResize.left);
    expect(afterResizeStep.left).toBeGreaterThan(40);
    expect(afterResizeStep.width).toBeLessThan(afterResize.width);
    expect(afterResizeStep.width).toBeGreaterThan(400);

    const beforeReverse = composer.getBoundingClientRect();
    composer.setMode("landing");
    controller.setTarget(0);
    controller.attachUi(composer);
    const reverseStart = composer.getBoundingClientRect();
    expect(reverseStart.left).toBeCloseTo(beforeReverse.left, 6);
    expect(reverseStart.width).toBeCloseTo(beforeReverse.width, 6);
    controller.step(0.1);
    const reverseMid = composer.getBoundingClientRect();
    expect(reverseMid.left).toBeGreaterThan(reverseStart.left);
    expect(reverseMid.left).toBeLessThan(250);
    expect(reverseMid.width).toBeGreaterThan(reverseStart.width);
    expect(reverseMid.width).toBeLessThan(500);
    for (let i = 0; i < 10; i++) controller.step(0.1);
    const reverseEnd = composer.getBoundingClientRect();
    expect(reverseEnd.left).toBeCloseTo(250, 6);
    expect(reverseEnd.width).toBeCloseTo(500, 6);
    expect(composer.style.getPropertyValue("translate")).toBe("");
    expect(composer.style.getPropertyValue("width")).toBe("");
  });

  it("refreshes a settled responsive destination", () => {
    const controller = new ParcelTransitionController();
    const composer = fakeComposer();
    composer.setMode("workspace");
    controller.reset(1);
    controller.attachUi(composer);
    composer.setWorkspace({ left: 40, top: 100, width: 400, height: 600 });
    controller.refreshUi();
    const destination = composer.getBoundingClientRect();
    expect(destination.left).toBe(40);
    expect(destination.width).toBe(400);
    expect(composer.style.getPropertyValue("translate")).toBe("");
  });

  it("bounds a delayed frame instead of skipping the composer leg", () => {
    const controller = new ParcelTransitionController();
    const composer = fakeComposer();
    controller.reset(0);
    controller.attachUi(composer);
    composer.setMode("workspace");
    controller.setTarget(1);
    controller.attachUi(composer);
    controller.step(10);
    const frame = composer.getBoundingClientRect();
    expect(frame.width).toBeGreaterThan(342);
    expect(frame.width).toBeLessThan(500);
    expect(composer.style.getPropertyValue("translate")).not.toBe("");
  });
});
