import { describe, expect, it, vi } from "vitest";
import {
  listChatGPTModels,
  validateChatGPTModels,
} from "../src/lib/server/chatgpt-models";
const model = {
  id: "gpt-5.6-luna",
  model: "gpt-5.6-luna",
  displayName: "Luna",
  hidden: false,
  defaultReasoningEffort: "low",
  supportedReasoningEfforts: [
    { reasoningEffort: "low", description: "low" },
    { reasoningEffort: "xhigh", description: "extended" },
  ],
};
const session = () => ({
  readAuthStatus: vi.fn().mockResolvedValue({ status: "connected" }),
  getSnapshot: vi.fn().mockReturnValue({ authStatus: "connected" }),
});
describe("ChatGPT model discovery", () => {
  it("requires an authenticated account before contacting the catalog", async () => {
    const rpc = { request: vi.fn() };
    const state = session();
    state.readAuthStatus.mockResolvedValue({ status: "disconnected" });
    await expect(listChatGPTModels(rpc, state as never)).rejects.toThrow();
    expect(rpc.request).not.toHaveBeenCalled();
  });
  it("paginates with fixed limits, removes hidden entries and strips private metadata", async () => {
    const rpc = {
      request: vi
        .fn()
        .mockResolvedValueOnce({
          data: [{ ...model, capability: "secret" }],
          nextCursor: "page2",
        })
        .mockResolvedValueOnce({
          data: [{ ...model, hidden: true }],
          nextCursor: null,
        }),
    };
    const result = await listChatGPTModels(rpc, session() as never);
    expect(result).toEqual([
      {
        id: model.id,
        model: model.model,
        displayName: "Luna",
        defaultReasoningEffort: "low",
        supportedReasoningEfforts: ["low", "xhigh"],
      },
    ]);
    expect(rpc.request).toHaveBeenLastCalledWith("model/list", {
      limit: 20,
      includeHidden: false,
      cursor: "page2",
    });
  });
  it("rejects stale authenticated state after logout during discovery", async () => {
    const state = session();
    state.getSnapshot.mockReturnValue({ authStatus: "unknown" });
    await expect(
      listChatGPTModels(
        { request: vi.fn().mockResolvedValue({ data: [model] }) },
        state as never,
      ),
    ).rejects.toThrow();
  });
  it("rejects repeated cursors and oversized pages", async () => {
    const request = vi
      .fn()
      .mockResolvedValue({ data: [], nextCursor: "repeat" });
    await expect(
      listChatGPTModels({ request }, session() as never),
    ).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(2);
    await expect(
      listChatGPTModels(
        { request: vi.fn().mockResolvedValue({ data: Array(21).fill(model) }) },
        session() as never,
      ),
    ).rejects.toThrow();
  });
  it("bounds pagination without silently returning a partial catalog", async () => {
    let cursor = 0;
    const request = vi
      .fn()
      .mockImplementation(async () => ({
        data: [],
        nextCursor: String(++cursor),
      }));
    await expect(
      listChatGPTModels({ request }, session() as never),
    ).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(5);
  });
  it("rejects duplicate models and unsupported default effort", () => {
    const publicModel = { ...model, supportedReasoningEfforts: ["low"] };
    expect(() => validateChatGPTModels([publicModel, publicModel])).toThrow();
    expect(() =>
      validateChatGPTModels([
        { ...publicModel, defaultReasoningEffort: "xhigh" },
      ]),
    ).toThrow();
  });
});
