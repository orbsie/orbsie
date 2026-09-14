import { expect, it } from "vitest";
import {
  parsePrivateSceneCompletion,
  PRIVATE_SCENE_COMPLETION_MAX_BYTES,
} from "../src/lib/server/chatgpt-scene-completion";

const record = {
  type: "orbsie.private.scene-completion",
  version: 1,
  operationId: "operation-1",
  epoch: 2,
  projectId: "world-1",
  revision: 4,
  bindingVersion: 1,
  digest: "a".repeat(64),
};
const expected = {
  operationId: "operation-1",
  epoch: 2,
  projectId: "world-1",
  minimumRevision: 3,
};
const parse = (value: unknown) =>
  parsePrivateSceneCompletion(JSON.stringify(value), expected);

it("accepts a versioned completion bound to the expected managed operation and scene", () => {
  expect(parse(record)).toEqual(record);
});
it.each([
  { operationId: "other" },
  { epoch: 1 },
  { projectId: "other" },
  { revision: 2 },
  { revision: Number.MAX_SAFE_INTEGER + 1 },
  { version: 2 },
  { bindingVersion: 2 },
  { digest: "invalid" },
  { phaseToken: "must-not-cross-http" },
  { prompt: "private" },
])("rejects substituted or unsupported metadata %j", (change) => {
  expect(() => parse({ ...record, ...change })).toThrow(
    "Invalid private scene completion.",
  );
});
it("rejects commands, malformed JSON and oversized UTF-8 records without echoing contents", () => {
  expect(() =>
    parse({ type: "commit_revision", message: "private prompt" }),
  ).toThrow("Invalid private scene completion.");
  expect(() =>
    parsePrivateSceneCompletion("private malformed output", expected),
  ).toThrow("Invalid private scene completion.");
  const oversized = `${JSON.stringify(record)}${" ".repeat(PRIVATE_SCENE_COMPLETION_MAX_BYTES)}`;
  expect(() => parsePrivateSceneCompletion(oversized, expected)).toThrow(
    "Invalid private scene completion.",
  );
});
it("rejects an invalid expected revision", () => {
  expect(() =>
    parsePrivateSceneCompletion(JSON.stringify(record), {
      ...expected,
      minimumRevision: NaN,
    }),
  ).toThrow("Invalid private scene completion.");
});
