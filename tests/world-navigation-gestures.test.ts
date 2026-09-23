import { describe, expect, it } from "vitest";
import {
  WorldNavigationGestureController,
  type NavigationViewport,
} from "../src/lib/world-navigation-gestures";

const viewport: NavigationViewport = {
  width: 1000,
  height: 1000,
  verticalFovRadians: Math.PI / 2,
  distance: 100,
  heading: 0,
};

describe("world navigation gesture recognizer", () => {
  it("maps background mouse drag into heading-aware horizontal ground pan", () => {
    const north = new WorldNavigationGestureController();
    north.pointerDown({
      pointerId: 1,
      pointerType: "mouse",
      button: "primary",
      x: 100,
      y: 100,
    });
    const northDrag = north.pointerMove(
      { pointerId: 1, x: 110, y: 110 },
      viewport,
    );
    expect(northDrag.commands[0]?.type).toBe("pan");
    if (northDrag.commands[0]?.type === "pan") {
      expect(northDrag.commands[0].delta[0]).toBeCloseTo(-2);
      expect(northDrag.commands[0].delta[1]).toBeCloseTo(-4);
    }
    expect(northDrag.handled).toBe(true);

    const east = new WorldNavigationGestureController();
    east.pointerDown({
      pointerId: 2,
      pointerType: "mouse",
      button: "primary",
      x: 100,
      y: 100,
    });
    const eastDrag = east.pointerMove(
      { pointerId: 2, x: 110, y: 110 },
      { ...viewport, heading: Math.PI / 2 },
    );
    expect(eastDrag.commands[0]?.type).toBe("pan");
    if (eastDrag.commands[0]?.type === "pan") {
      expect(eastDrag.commands[0].delta[0]).toBeCloseTo(4);
      expect(eastDrag.commands[0].delta[1]).toBeCloseTo(2);
    }
  });

  it("pans with one-finger background touch drag and suppresses its click", () => {
    const gestures = new WorldNavigationGestureController();
    gestures.pointerDown({
      pointerId: 7,
      pointerType: "touch",
      x: 20,
      y: 30,
    });
    expect(
      gestures.pointerMove({ pointerId: 7, x: 22, y: 32 }, viewport),
    ).toEqual({ commands: [], handled: false, suppressClick: false });
    const drag = gestures.pointerMove({ pointerId: 7, x: 30, y: 40 }, viewport);
    expect(drag.commands).toHaveLength(1);
    expect(drag.suppressClick).toBe(true);
    expect(gestures.pointerUp(7).suppressClick).toBe(true);
    expect(gestures.consumeClickSuppression(7)).toBe(true);
    expect(gestures.consumeClickSuppression(7)).toBe(false);
  });

  it("rotates with secondary mouse drag and normalizes heading", () => {
    const gestures = new WorldNavigationGestureController();
    gestures.pointerDown({
      pointerId: 4,
      pointerType: "mouse",
      button: "secondary",
      x: 900,
      y: 10,
    });
    const rotated = gestures.pointerMove(
      { pointerId: 4, x: 1100, y: 10 },
      { ...viewport, heading: (Math.PI * 7) / 4 },
    );
    expect(rotated.commands).toEqual([
      { type: "rotate_to_heading", heading: (Math.PI * 3) / 20 },
    ]);
    expect(rotated.suppressClick).toBe(true);
  });

  it("zooms with two-finger pinch and suppresses clicks for both pointers", () => {
    const gestures = new WorldNavigationGestureController();
    gestures.pointerDown({
      pointerId: 10,
      pointerType: "touch",
      x: 100,
      y: 100,
    });
    gestures.pointerDown({
      pointerId: 11,
      pointerType: "touch",
      x: 200,
      y: 100,
    });

    const pinch = gestures.pointerMove(
      { pointerId: 11, x: 250, y: 100 },
      viewport,
    );
    expect(pinch.commands).toEqual([{ type: "zoom", factor: 2 / 3 }]);
    expect(pinch.suppressClick).toBe(true);
    expect(gestures.pointerUp(10)).toMatchObject({
      handled: true,
      suppressClick: true,
    });
    expect(gestures.pointerUp(11)).toMatchObject({
      handled: true,
      suppressClick: true,
    });
    expect(gestures.consumeClickSuppression(10)).toBe(true);
    expect(gestures.consumeClickSuppression(11)).toBe(true);
  });

  it("zooms from wheel delta and rejects invalid wheel or projection values", () => {
    const gestures = new WorldNavigationGestureController();
    const zoomIn = gestures.wheel({ deltaY: -100 }, viewport);
    expect(zoomIn.handled).toBe(true);
    expect(zoomIn.commands[0]).toMatchObject({ type: "zoom" });
    if (zoomIn.commands[0]?.type === "zoom")
      expect(zoomIn.commands[0].factor).toBeLessThan(1);

    expect(gestures.wheel({ deltaY: Number.NaN }, viewport).commands).toEqual(
      [],
    );
    expect(
      gestures.wheel({ deltaY: 100 }, { ...viewport, height: 0 }).commands,
    ).toEqual([]);
  });

  it("leaves object-hit starts to object interaction without consuming clicks", () => {
    const gestures = new WorldNavigationGestureController();
    gestures.pointerDown({
      pointerId: 5,
      pointerType: "mouse",
      button: "primary",
      x: 100,
      y: 100,
      objectHit: true,
    });
    expect(
      gestures.pointerMove({ pointerId: 5, x: 300, y: 300 }, viewport),
    ).toEqual({ commands: [], handled: false, suppressClick: false });
    expect(gestures.pointerUp(5).suppressClick).toBe(false);
    expect(gestures.consumeClickSuppression(5)).toBe(false);

    gestures.pointerDown({
      pointerId: 6,
      pointerType: "touch",
      x: 100,
      y: 100,
    });
    gestures.pointerDown({
      pointerId: 7,
      pointerType: "touch",
      x: 200,
      y: 100,
      objectHit: true,
    });
    expect(
      gestures.pointerMove({ pointerId: 6, x: 250, y: 100 }, viewport),
    ).toEqual({ commands: [], handled: false, suppressClick: false });
  });

  it("keeps pinch, mouse drag, and cleanup isolated by pointer ID", () => {
    const gestures = new WorldNavigationGestureController();
    gestures.pointerDown({
      pointerId: 10,
      pointerType: "touch",
      x: 100,
      y: 100,
    });
    gestures.pointerDown({
      pointerId: 11,
      pointerType: "touch",
      x: 200,
      y: 100,
    });
    gestures.pointerDown({
      pointerId: 2,
      pointerType: "mouse",
      button: "primary",
      x: 10,
      y: 10,
    });

    expect(
      gestures.pointerMove({ pointerId: 99, x: 500, y: 500 }, viewport),
    ).toEqual({ commands: [], handled: false, suppressClick: false });
    expect(
      gestures.pointerMove({ pointerId: 2, x: 20, y: 10 }, viewport).commands,
    ).toHaveLength(1);
    gestures.pointerUp(2);
    expect(
      gestures.pointerMove({ pointerId: 11, x: 250, y: 100 }, viewport)
        .commands,
    ).toEqual([{ type: "zoom", factor: 2 / 3 }]);

    gestures.pointerCancel(2);
    expect(
      gestures.pointerMove({ pointerId: 11, x: 300, y: 100 }, viewport)
        .commands,
    ).toEqual([{ type: "zoom", factor: 150 / 200 }]);
  });

  it("clears cancelled or blurred pointers and suppression state", () => {
    const gestures = new WorldNavigationGestureController();
    gestures.pointerDown({
      pointerId: 1,
      pointerType: "mouse",
      button: "primary",
      x: 0,
      y: 0,
    });
    gestures.pointerMove({ pointerId: 1, x: 10, y: 0 }, viewport);
    expect(gestures.pointerCancel(1).handled).toBe(true);
    expect(gestures.consumeClickSuppression(1)).toBe(false);
    expect(gestures.pointerUp(1)).toEqual({
      commands: [],
      handled: false,
      suppressClick: false,
    });

    gestures.pointerDown({
      pointerId: 3,
      pointerType: "mouse",
      button: "primary",
      x: 0,
      y: 0,
    });
    gestures.pointerMove({ pointerId: 3, x: 10, y: 0 }, viewport);
    gestures.blur();
    expect(gestures.consumeClickSuppression(3)).toBe(false);
    expect(gestures.pointerUp(3).handled).toBe(false);

    gestures.pointerDown({
      pointerId: 4,
      pointerType: "mouse",
      button: "primary",
      x: 0,
      y: 0,
    });
    gestures.pointerMove({ pointerId: 4, x: 10, y: 0 }, viewport);
    gestures.reset();
    expect(gestures.consumeClickSuppression(4)).toBe(false);
    expect(gestures.pointerUp(4).handled).toBe(false);
  });

  it("ignores non-finite positions and degenerates without emitting commands", () => {
    const gestures = new WorldNavigationGestureController();
    gestures.pointerDown({
      pointerId: 1,
      pointerType: "mouse",
      button: "primary",
      x: 0,
      y: 0,
    });
    expect(
      gestures.pointerMove(
        { pointerId: 1, x: 100, y: 100 },
        { ...viewport, verticalFovRadians: Math.PI },
      ).commands,
    ).toEqual([]);
    expect(
      gestures.pointerMove(
        { pointerId: 1, x: Number.POSITIVE_INFINITY, y: 0 },
        viewport,
      ),
    ).toEqual({ commands: [], handled: false, suppressClick: false });
    const pan = gestures.pointerMove({ pointerId: 1, x: 10, y: 10 }, viewport);
    expect(pan.commands[0]?.type).toBe("pan");
    if (pan.commands[0]?.type === "pan") {
      expect(pan.commands[0].delta[0]).toBeCloseTo(-2);
      expect(pan.commands[0].delta[1]).toBeCloseTo(-4);
    }

    const overflow = new WorldNavigationGestureController();
    overflow.pointerDown({
      pointerId: 2,
      pointerType: "mouse",
      button: "primary",
      x: 1e308,
      y: 0,
    });
    expect(
      overflow.pointerMove({ pointerId: 2, x: -1e308, y: 0 }, viewport),
    ).toEqual({ commands: [], handled: false, suppressClick: false });
  });
});
