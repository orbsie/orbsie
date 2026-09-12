import { expect, it } from "vitest";
import { createTraversalTouchInput } from "../scripts/lib/traversal-touch-input.mjs";

it("retains independent direction, diagonal, and jump touches across partial release", async () => {
  const calls: Array<{
    type: string;
    touchPoints: Array<{ x: number; y: number; id: number }>;
  }> = [];
  const points = new Map<string, { x: number; y: number; id: number }>();
  const input = createTraversalTouchInput({
    cdp: {
      send: async (method: string, params: any) => {
        expect(method).toBe("Input.dispatchTouchEvent");
        calls.push(params);
      },
    },
    touchPoint: async (key: string, id: number) => {
      const point = { x: id, y: id + 1, id };
      points.set(key, point);
      return point;
    },
  });

  await input.setKeys(["d", "s", " "]);
  expect(input.heldKeys()).toEqual(["d", "s", " "]);
  expect(new Set([...points.values()].map((point) => point.id)).size).toBe(3);
  expect(calls.map((call) => call.type)).toEqual([
    "touchStart",
    "touchStart",
    "touchStart",
  ]);
  expect(calls.at(-1)?.touchPoints.map((point) => point.id)).toEqual([
    101, 102, 103,
  ]);

  await input.setKeys(["d", "s"]);
  expect(input.heldKeys()).toEqual(["d", "s"]);
  expect(calls.at(-1)).toEqual({
    type: "touchEnd",
    touchPoints: [points.get(" ")],
  });

  await input.setKeys(["s"]);
  expect(input.heldKeys()).toEqual(["s"]);
  expect(calls.at(-1)).toEqual({
    type: "touchEnd",
    touchPoints: [points.get("d")],
  });

  await input.releaseAll();
  expect(input.heldKeys()).toEqual([]);
  expect(calls.at(-1)).toEqual({
    type: "touchEnd",
    touchPoints: [points.get("s")],
  });
});
