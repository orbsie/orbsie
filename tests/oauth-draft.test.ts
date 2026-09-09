import { expect, it } from "vitest";
import { encodeOAuthDraft, decodeOAuthDraft } from "../src/lib/oauth-draft";
const draft = {
  version: 1 as const,
  state: "a".repeat(43),
  createdAt: 1000,
  prompt: "Make a garden 🌷",
  projectId: "world-1",
  selectedId: "tree-1",
};
it("round trips scoped authoring input without allowing credential fields", () => {
  expect(decodeOAuthDraft(encodeOAuthDraft(draft), draft.state, 1001)).toEqual(
    draft,
  );
  expect(() =>
    encodeOAuthDraft({ ...draft, key: "secret" } as typeof draft),
  ).toThrow();
});
it("ignores stale, future, malformed and mismatched callbacks", () => {
  const encoded = encodeOAuthDraft(draft);
  expect(decodeOAuthDraft(encoded, "b".repeat(43), 1001)).toBeNull();
  expect(decodeOAuthDraft(encoded, draft.state, 601001)).toBeNull();
  expect(decodeOAuthDraft(encoded, draft.state, 999)).toBeNull();
  expect(decodeOAuthDraft("{", draft.state)).toBeNull();
  expect(decodeOAuthDraft("x".repeat(30001), draft.state)).toBeNull();
});
