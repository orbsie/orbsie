import { expect, test } from "vitest";
import {
  assertPinkOnlyEdit,
  LocalChatGPT,
  selectAstra,
} from "../scripts/local-chatgpt.mjs";
test("uses exact Astra catalog model identifier with low support", () => {
  expect(
    selectAstra([
      {
        id: "entry",
        model: "actual-astra-id",
        displayName: "Astra",
        supportedReasoningEfforts: [{ reasoningEffort: "low" }],
      },
    ]),
  ).toBe("actual-astra-id");
});
test("never falls back to other models or unsupported reasoning", () => {
  expect(() =>
    selectAstra([
      {
        id: "other",
        model: "other",
        supportedReasoningEfforts: [{ reasoningEffort: "low" }],
      },
    ]),
  ).toThrow("no fallback");
  expect(() =>
    selectAstra([
      {
        id: "astra",
        model: "astra",
        supportedReasoningEfforts: [{ reasoningEffort: "high" }],
      },
    ]),
  ).toThrow("no fallback");
});

test("pink-only validation preserves selected geometry, transform, behavior, and environment", () => {
  const before = {
    entities: [
      {
        id: "selected",
        color: "#111111",
        position: [1, 2, 3],
        geometry: {
          kind: "rock",
          detail: "refined",
          parts: [],
          tint: "#111111",
        },
        behavior: { type: "bounce" },
      },
    ],
    environment: { sky: "#000000" },
  };
  const after = structuredClone(before);
  after.entities[0].color = "#ff44aa";
  after.entities[0].geometry.tint = "#ff44aa";
  expect(() =>
    assertPinkOnlyEdit(before, after, "selected", "#ff44aa"),
  ).not.toThrow();
  const wrongTint = structuredClone(after);
  wrongTint.entities[0].geometry.tint = "#000000";
  expect(() =>
    assertPinkOnlyEdit(before, wrongTint, "selected", "#ff44aa"),
  ).toThrow("material tint");
  for (const mutation of [
    { position: [9, 2, 3] },
    { geometry: { kind: "flower", detail: "refined", parts: [] } },
    { behavior: { type: "static" } },
  ]) {
    const changed = structuredClone(after);
    Object.assign(changed.entities[0], mutation);
    expect(() =>
      assertPinkOnlyEdit(before, changed, "selected", "#ff44aa"),
    ).toThrow("beyond its color");
  }
  const environmentChanged = structuredClone(after);
  environmentChanged.environment.sky = "#ffffff";
  expect(() =>
    assertPinkOnlyEdit(before, environmentChanged, "selected", "#ff44aa"),
  ).toThrow("environment");
});

test("cancellation after delayed thread start does not start a turn", async () => {
  const client = Object.create(LocalChatGPT.prototype);
  client.listeners = new Set();
  client.model = "astra";
  const calls: string[] = [];
  client.request = async (method: string) => {
    calls.push(method);
    if (method === "thread/start") {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { thread: { id: "thread" } };
    }
    throw Error(`unexpected request: ${method}`);
  };
  const controller = new AbortController();
  const generation = client.generate(
    "instructions",
    {},
    () => {},
    controller.signal,
  );
  setTimeout(() => controller.abort(), 1);
  await expect(generation).rejects.toThrow();
  expect(calls).toEqual(["thread/start"]);
});

test("Orbsie generation explicitly uses standard processing and retains low reasoning", async () => {
  const client = Object.create(LocalChatGPT.prototype);
  client.listeners = new Set();
  client.model = "gpt-6-astra";
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  client.request = async (method: string, params: Record<string, unknown>) => {
    calls.push({ method, params });
    if (method === "thread/start") return { thread: { id: "thread" } };
    throw Error("Stop before inference");
  };
  await expect(client.generate("instructions", {}, () => {})).rejects.toThrow(
    "Stop before inference",
  );
  expect(calls.map(({ method }) => method)).toEqual([
    "thread/start",
    "turn/start",
  ]);
  for (const { params } of calls) {
    expect(params.serviceTier).toBe("default");
    expect(params.model).toBe("gpt-6-astra");
  }
  expect(calls[1].params.effort).toBe("low");
});
