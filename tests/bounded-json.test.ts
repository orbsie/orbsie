import { expect, it, vi } from "vitest";
import { boundedJSON } from "../src/lib/server/auth";
it("reads split UTF-8 JSON and measures bytes instead of characters", async () => {
  const bytes = new TextEncoder().encode('{"value":"é"}');
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes.slice(0, 11));
      controller.enqueue(bytes.slice(11));
      controller.close();
    },
  });
  const request = new Request("http://localhost", {
    method: "POST",
    body,
    duplex: "half",
  } as RequestInit);
  expect(await boundedJSON(request, bytes.length)).toEqual({ value: "é" });
  await expect(
    boundedJSON(
      new Request("http://localhost", {
        method: "POST",
        body: '{"value":"é"}',
      }),
      bytes.length - 1,
    ),
  ).rejects.toMatchObject({ status: 413 });
});
it("cancels an oversized stream despite a false content length", async () => {
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(50));
    },
    cancel,
  });
  await expect(
    boundedJSON(
      new Request("http://localhost", {
        method: "POST",
        headers: { "Content-Length": "1" },
        body,
        duplex: "half",
      } as RequestInit),
      10,
    ),
  ).rejects.toMatchObject({ status: 413 });
  expect(cancel).toHaveBeenCalledOnce();
});
it("rejects invalid JSON and invalid UTF-8", async () => {
  for (const body of ["{", new Uint8Array([0xff])])
    await expect(
      boundedJSON(new Request("http://localhost", { method: "POST", body })),
    ).rejects.toMatchObject({ status: 400 });
});
