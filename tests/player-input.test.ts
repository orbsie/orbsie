import { describe, expect, it } from "vitest";
import {
  PlayerInputTracker,
  actionForPlayerKey,
} from "../src/lib/player-input";

describe("player input lifecycle", () => {
  it("maps keyboard aliases and queues each held action edge once", () => {
    const input = new PlayerInputTracker();

    expect(actionForPlayerKey("ArrowRight")).toBe("right");
    input.setKeyboard("d", true);
    input.setKeyboard("d", true);
    input.setKeyboard("ArrowRight", true);
    expect(input.consumePressed()).toEqual(["right"]);
    expect(input.isHeld("right")).toBe(true);

    input.setKeyboard("d", false);
    expect(input.isHeld("right")).toBe(true);
    input.setKeyboard("ArrowRight", false);
    expect(input.isHeld("right")).toBe(false);

    input.setKeyboard(" ", true);
    input.setKeyboard(" ", false);
    expect(input.isHeld("jump")).toBe(false);
  });

  it("keeps an action held until every pointer using it is released", () => {
    const input = new PlayerInputTracker();

    input.setPointer(11, "d", true);
    input.setPointer(12, "d", true);
    input.setPointer(13, " ", true);
    expect(input.consumePressed()).toEqual(["right", "jump"]);
    input.setPointer(11, "d", false);
    expect(input.isHeld("right")).toBe(true);
    expect(input.isHeld("jump")).toBe(true);
    input.setPointer(12, "d", false);
    input.setPointer(13, " ", false);
    expect(input.isHeld("right")).toBe(false);
    expect(input.isHeld("jump")).toBe(false);
  });

  it("clears held actions and pending edges when the page lifecycle resets", () => {
    const input = new PlayerInputTracker();

    input.setPointer("legacy:d", "d", true);
    input.setKeyboard("w", true);
    input.clear();
    expect(input.consumePressed()).toEqual([]);
    expect(input.isHeld("right")).toBe(false);
    expect(input.isHeld("up")).toBe(false);
  });
});
