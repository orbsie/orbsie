import { expect, it } from "vitest";
import { blankProject } from "../src/lib/protocol";
import { authoringHistory } from "../src/lib/authoring-history";

it("retains earlier instructions without duplicating the current request", () => {
  const project = blankProject();
  project.messages = [
    { role: "user", text: "Create a new pink vase. No catalog models." },
    { role: "assistant", text: "The base is finished." },
    { role: "user", text: "Finish the neck" },
  ];
  expect(authoringHistory(project, "Finish the neck")).toEqual(
    project.messages.slice(0, 2),
  );
});

it("bounds context while preserving whole messages and their order", () => {
  const project = blankProject();
  project.messages = Array.from({ length: 20 }, (_, i) => ({
    role: "user",
    text: `${i}`.padEnd(1500, "x"),
  }));
  const history = authoringHistory(project, "Next");
  expect(history).toEqual(project.messages.slice(-5));
  expect(
    history.reduce((sum, message) => sum + message.text.length, 0),
  ).toBeLessThanOrEqual(8000);
  project.messages = Array.from({ length: 20 }, () => ({
    role: "assistant",
    text: "Done",
  }));
  expect(authoringHistory(project, "Next")).toHaveLength(8);
});

it("does not forward stale selection references or mutate the saved history", () => {
  const project = blankProject();
  project.messages = [
    { role: "user", text: "Change this", entityId: "removed" },
  ];
  expect(authoringHistory(project, "Next")).toEqual([
    { role: "user", text: "Change this" },
  ]);
  expect(project.messages[0].entityId).toBe("removed");
});
