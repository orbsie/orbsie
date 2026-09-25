import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { Project } from "../src/lib/protocol";
import {
  DIRECT_GROUND_JUMP_SCOPE,
  observeDirectGroundJump,
} from "../src/lib/scene-playability";

const savedRevision29 = JSON.parse(
  readFileSync(
    resolve(
      "docs/evidence/provider-e2e/openrouter-flagship-gpt6-luna-live-20260925-recheck/openrouter/story-created-project.json",
    ),
    "utf8",
  ),
) as Project;

describe("direct ground-jump playability advisory", () => {
  it("reports clearance to the nearest traversal platform using runtime math", () => {
    const observation = observeDirectGroundJump(savedRevision29);

    expect(observation).toEqual({
      version: 1,
      status: "observed",
      scope: DIRECT_GROUND_JUMP_SCOPE,
      entityId: "bounce-1",
      landingCenter: [0, 1.64, 0],
      idealApexY: 1.62,
      signedClearance: -0.02,
    });
  });

  it("reports a platform below the ideal apex without calling it a failure", () => {
    const project = structuredClone(savedRevision29);
    const nearest = project.entities.find((entity) => entity.id === "bounce-1");
    if (!nearest) throw new Error("Saved fixture is missing bounce-1.");
    nearest.scale[1] = 0.5;

    const observation = observeDirectGroundJump(project);
    expect(observation).toMatchObject({
      status: "observed",
      entityId: "bounce-1",
      idealApexY: 1.62,
      signedClearance: 0.24,
    });
  });

  it("observes a built-in moving traversal platform without bounce behavior", () => {
    const project = structuredClone(savedRevision29);
    const nearest = project.entities.find((entity) => entity.id === "bounce-1");
    if (!nearest) throw new Error("Saved fixture is missing bounce-1.");
    nearest.behavior = {
      type: "move",
      axis: "x",
      amplitude: 1,
      speed: 1,
    };

    expect(observeDirectGroundJump(project)).toMatchObject({
      status: "observed",
      entityId: "bounce-1",
      signedClearance: -0.02,
    });
  });

  it("skips airborne spawns and unsupported geometry or transforms", () => {
    const airborne = structuredClone(savedRevision29);
    if (!airborne.game?.spawn)
      throw new Error("Saved fixture is missing its game spawn.");
    airborne.game.spawn[1] = 2;
    expect(observeDirectGroundJump(airborne)).toMatchObject({
      status: "skipped",
      reason: "spawn-not-ground-level",
    });

    const rotated = structuredClone(savedRevision29);
    for (const entity of rotated.entities) {
      if (entity.geometry?.kind === "platform") entity.rotation = [0, 0.25, 0];
    }
    expect(observeDirectGroundJump(rotated)).toMatchObject({
      status: "skipped",
      reason: "unsupported-platform-transform",
    });

    const parented = structuredClone(savedRevision29);
    for (const entity of parented.entities) {
      if (entity.geometry?.kind === "platform")
        entity.parentId = "platform-group";
    }
    expect(observeDirectGroundJump(parented)).toMatchObject({
      status: "skipped",
      reason: "unsupported-platform-transform",
    });

    const generated = structuredClone(savedRevision29);
    for (const entity of generated.entities) {
      if (entity.geometry?.kind === "platform")
        entity.geometry = {
          kind: "generated",
          collision: "platform",
        } as Project["entities"][number]["geometry"];
    }
    expect(observeDirectGroundJump(generated)).toMatchObject({
      status: "skipped",
      reason: "no-ready-built-in-platform",
    });
  });

  it("skips a selected platform whose authored path moves vertically", () => {
    const project = structuredClone(savedRevision29);
    const path = project.game?.rules
      .flatMap((rule) => rule.actions)
      .find(
        (action) =>
          action.type === "move_path" && action.entityId === "bounce-1",
      );
    if (!path || path.type !== "move_path")
      throw new Error("Saved fixture is missing bounce-1's move path.");
    path.points[1][1] += 0.5;

    expect(observeDirectGroundJump(project)).toMatchObject({
      status: "skipped",
      reason: "vertical-platform-motion",
    });
  });
});
