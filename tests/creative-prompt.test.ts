import { describe, expect, it } from "vitest";
import { blankProject } from "../src/lib/protocol";
import {
  authoringPromptSections,
  systemPromptForCapabilities,
} from "../src/lib/server/generation";
import { createChatGPTSceneStream } from "../src/lib/server/chatgpt-scene-stream";

const formats = [
  "ndjson",
  "json-object",
  "json-schema",
  "json-schema-strict",
] as const;

const coreGuidance = [
  "Use recentConversation only as context",
  "recognizable silhouette",
  "defining silhouette and relative scale",
  "requested attached forms visibly connected and unobscured before surface decoration",
  "preserve requested colors on defining features",
  "When a catalog asset cannot express a requested defining feature",
  "keeping suitable catalog pieces",
  "Do not mandate a fixed style, prop arrangement, or template catalogue",
  "Explicit new-only policy prohibits catalog reuse for that scope",
  "reachable objective",
  "Reserve only NEW entities FIRST",
  "Finish referenced entities to ready before set_game",
  "Each command must match the provided command schema",
];

describe("creative and playable authoring prompt", () => {
  it("assembles named sections in their priority order", () => {
    expect(Object.keys(authoringPromptSections)).toEqual([
      "currentUserIntentAndPreservation",
      "artisticIntent",
      "playableExperience",
      "stagedAuthoring",
      "supportedCapabilitiesAndOutput",
    ]);

    const prompt = systemPromptForCapabilities();
    const positions = Object.values(authoringPromptSections).map((section) =>
      prompt.indexOf(section),
    );
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("preserves identity for edits while allowing requested removal", () => {
    const prompt = systemPromptForCapabilities();
    expect(prompt).toContain(
      "never reserve them again or remove/recreate them as an editing shortcut",
    );
    expect(prompt).toContain(
      "Remove only objects the current request asks to remove, respecting game and group references",
    );
  });

  it("allows horizontal worlds while preserving explicit bounded game spaces", () => {
    const prompt = systemPromptForCapabilities();
    expect(prompt).toContain(
      "default ground extends in every horizontal direction",
    );
    expect(prompt).toContain(
      "Create a bounded island, walls, cliffs, or other barriers only when the user or game concept explicitly calls for them",
    );
    expect(prompt).toContain(
      "Treat authored islands and barriers as visual geometry unless a supported interaction mechanic provides the requested behavior; do not imply or rely on physical containment from them",
    );
    expect(prompt).toContain(
      "Entity and group position components may use finite parent-local coordinates from -1,000,000 to 1,000,000 meters",
    );
    expect(prompt).toContain("Use at most 70 objects");
    expect(prompt).toContain(
      "local custom-part positions, scales, and rotations",
    );
    expect(prompt).not.toContain("island has radius 8");
    expect(prompt).not.toContain("Keep all objects on the island");
  });

  it.each(
    formats.flatMap((outputFormat) =>
      [false, true].flatMap((localModeling) =>
        [false, true].map(
          (browserModeling) =>
            [outputFormat, localModeling, browserModeling] as const,
        ),
      ),
    ),
  )(
    "retains creative, gameplay, preservation and policy guidance for %s local=%s browser=%s",
    (outputFormat, localModeling, browserModeling) => {
      const prompt = systemPromptForCapabilities(
        localModeling,
        browserModeling,
        outputFormat,
      );
      for (const guidance of coreGuidance) expect(prompt).toContain(guidance);
      expect(prompt).toContain(
        'keep the entity behavior.type as "bounce" and use a game-program move_path action on that same entity',
      );
      expect(prompt).toContain("JUMP_SPEED 6 and gravity 15 (ideal rise 1.2");
      expect(prompt).toContain("Aim for at most 16 custom parts per object");
      expect(prompt).toContain(
        "custom-parts geometry schema hard limit is 32 parts per object",
      );
      if (localModeling) expect(prompt).toContain("typed local Blender job");
      if (browserModeling) expect(prompt).toContain("browser-manifold recipe");
    },
  );

  it("passes the shared authoring contract to hosted ChatGPT", async () => {
    let instructions = "";
    const stream = createChatGPTSceneStream(
      {
        prompt: "Build a small playable garden",
        project: blankProject(),
        model: "gpt-6-luna",
        effort: "low",
        browserModeling: true,
      },
      {
        generate: async (input) => {
          instructions = input.instructions;
          input.onText('{"type":"commit_revision","message":"Ready"}\n');
        },
      },
    );

    await new Response(stream).text();
    expect(instructions).toContain("ARTISTIC INTENT");
    expect(instructions).toContain("PLAYABLE EXPERIENCE");
    expect(instructions).toContain("browser-manifold recipe");
    expect(instructions).toContain(
      "Each command must match the provided command schema",
    );
  });
});
