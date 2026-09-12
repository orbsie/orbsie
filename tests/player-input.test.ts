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

describe("player input latency telemetry", () => {
  it("records acceptance to simulation-consumption latency with an injected clock", () => {
    let now = 100;
    const input = new PlayerInputTracker({
      latencyTelemetry: true,
      clock: () => now,
    });

    input.setKeyboard("d", true);
    now = 117.5;
    expect(input.consumePressed()).toEqual(["right"]);
    expect(input.getLatencySnapshot()).toEqual({
      sampleCount: 1,
      samplesMs: [17.5],
    });
  });

  it("records one sample for duplicate held keyboard and pointer sources", () => {
    let now = 10;
    const input = new PlayerInputTracker({
      latencyTelemetry: true,
      clock: () => now,
    });

    input.setKeyboard("d", true);
    input.setKeyboard("d", true);
    input.setPointer(1, "d", true);
    input.setPointer(2, "d", true);
    now = 20;
    expect(input.consumePressed()).toEqual(["right"]);
    expect(input.getLatencySnapshot().samplesMs).toEqual([10]);
  });

  it("clears pending telemetry when held input state is reset", () => {
    let now = 10;
    const input = new PlayerInputTracker({
      latencyTelemetry: true,
      clock: () => now,
    });

    input.setKeyboard("w", true);
    input.clear();
    now = 30;
    expect(input.consumePressed()).toEqual([]);
    expect(input.getLatencySnapshot()).toEqual({
      sampleCount: 0,
      samplesMs: [],
    });
  });

  it("retains at most 128 latency samples and returns a protected copy", () => {
    let now = 0;
    const input = new PlayerInputTracker({
      latencyTelemetry: true,
      clock: () => now,
    });

    for (let index = 0; index < 130; index += 1) {
      input.setPointer(index, "d", true);
      now += 1;
      input.consumePressed();
      input.setPointer(index, "d", false);
    }

    const snapshot = input.getLatencySnapshot();
    expect(snapshot.sampleCount).toBe(128);
    expect(snapshot.samplesMs).toEqual(Array(128).fill(1));
    snapshot.samplesMs[0] = 999;
    expect(input.getLatencySnapshot().samplesMs[0]).toBe(1);
  });

  it("omits samples when the injected clock is unavailable or regresses", () => {
    let now = 10;
    const input = new PlayerInputTracker({
      latencyTelemetry: true,
      clock: () => now,
    });

    input.setKeyboard("d", true);
    now = 5;
    input.consumePressed();
    expect(input.getLatencySnapshot().samplesMs).toEqual([]);

    input.setKeyboard("d", false);
    now = Number.NaN;
    input.setKeyboard("d", true);
    now = 20;
    input.consumePressed();
    expect(input.getLatencySnapshot().samplesMs).toEqual([]);
  });
});
