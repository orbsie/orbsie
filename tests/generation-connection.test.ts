import { expect, it } from "vitest";
import {
  companionOrigin,
  generationRequest,
  readCompanionLink,
} from "../src/lib/generation-connection";
const token = "a".repeat(64);
it("consumes only the local companion link format", () => {
  expect(readCompanionLink("#orb=project")).toBeNull();
  expect(
    readCompanionLink(
      `#chatgpt=${encodeURIComponent(JSON.stringify({ url: "http://127.0.0.1:41000", token }))}`,
    ),
  ).toEqual({ url: "http://127.0.0.1:41000", token });
});
it.each([
  "https://example.com",
  "http://localhost:41000",
  "http://127.0.0.1:41000/elsewhere",
  "http://user:pass@127.0.0.1:41000",
  "http://127.0.0.1:41000?redirect=evil",
  "http://127.0.0.1",
])("rejects a companion outside its exact loopback origin: %s", (url) => {
  expect(() => companionOrigin(url)).toThrow();
  expect(() =>
    readCompanionLink(
      `#chatgpt=${encodeURIComponent(JSON.stringify({ url, token }))}`,
    ),
  ).toThrow("invalid");
});
it("sends the temporary capability only to the companion, never in model input", () => {
  const payload = { prompt: "A little garden", project: { id: "world" } };
  const request = generationRequest(
    {
      provider: "chatgpt-local",
      url: "http://127.0.0.1:41000",
      model: "gpt-6-astra",
      key: token,
    },
    payload,
  );
  expect(request.url).toBe("http://127.0.0.1:41000/generate");
  expect(request.init.credentials).toBe("omit");
  expect(request.init.redirect).toBe("error");
  expect(request.init.headers).toMatchObject({
    Authorization: `Bearer ${token}`,
  });
  expect(JSON.parse(request.init.body as string)).toEqual(payload);
  expect(request.init.body).not.toContain(token);
});
it("keeps API-provider keys on the hosted provider route and omits stale companion addresses", () => {
  const request = generationRequest(
    {
      provider: "gateway",
      model: "test-model",
      key: "test-api-key",
      url: "http://127.0.0.1:41000",
    },
    { prompt: "test" },
  );
  expect(request.url).toBe("/api/generate");
  expect(request.init.headers).not.toHaveProperty("Authorization");
  expect(JSON.parse(request.init.body as string)).toEqual({
    provider: "gateway",
    model: "test-model",
    key: "test-api-key",
    prompt: "test",
  });
});
it("never falls back to free generation for unknown connections", () => {
  expect(() =>
    generationRequest({ provider: "unknown", model: "", key: "" }, {}),
  ).toThrow("supported");
});
