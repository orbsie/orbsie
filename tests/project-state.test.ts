import { expect, it } from "vitest";
import {
  scopedValue,
  createProjectScope,
  readPublication,
} from "../src/lib/project-state";

it("never supplies A's revision as B's base even when revision numbers coincide", () => {
  const baseline = { projectId: "A", value: 4 };
  expect(scopedValue(baseline, "A")).toBe(4);
  expect(scopedValue(baseline, "B")).toBeNull();
});
it("hides A's READY publication and URL immediately when B is selected", () => {
  const publication = {
    projectId: "A",
    value: { state: "READY", servedRevision: 4, url: "https://a.example" },
  };
  expect(scopedValue(publication, "B")).toBeNull();
});
it("clears a missing publication", async () => {
  expect(
    await readPublication(new Response(null, { status: 404 }), () => true),
  ).toBeNull();
});
it("ignores JSON decoding that completes after switching away and back", async () => {
  const scope = createProjectScope("A");
  const current = scope.capture();
  let resolve!: (value: unknown) => void;
  const response = {
    status: 200,
    ok: true,
    json: () =>
      new Promise((r) => {
        resolve = r;
      }),
  } as Response;
  const pending = readPublication(response, current);
  scope.select("B");
  scope.select("A");
  resolve({ state: "READY", url: "https://obsolete.example" });
  expect(await pending).toBeUndefined();
  expect(current()).toBe(false);
  expect(scope.capture()()).toBe(true);
});
it("keeps requests valid across edits of the same project", () => {
  const scope = createProjectScope("A");
  const current = scope.capture();
  scope.select("A");
  expect(current()).toBe(true);
});
