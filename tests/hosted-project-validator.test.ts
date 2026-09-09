import { beforeAll, describe, expect, it } from "vitest";
import {
  HOSTED_EFFORT,
  HOSTED_MODEL,
} from "../scripts/lib/hosted-chatgpt-acceptance.mjs";
import { loadHostedProjectValidator } from "../scripts/lib/hosted-project-validator.mjs";
import { installTrafficGuard } from "../scripts/provider-browser-e2e.mjs";

const target = "https://orbsie.example.test";

const initialProject = {
  version: 1 as const,
  id: "project",
  title: "An untitled little world",
  seed: 42,
  revision: 0,
  entities: [],
  environment: { sky: "#dceee9", ground: "#91b977", water: "#59bdbb" },
  messages: [],
};

function requestFor(project: unknown) {
  return {
    model: HOSTED_MODEL,
    effort: HOSTED_EFFORT,
    prompt: "Create a small island.",
    project,
    browserModeling: true,
    localModeling: false,
  };
}

async function routeThroughGuard(
  project: unknown,
  hostedProjectValidator: (value: unknown) => boolean,
) {
  let handler: ((route: any) => Promise<void>) | undefined;
  await installTrafficGuard(
    {
      route: async (
        _pattern: string,
        callback: (route: any) => Promise<void>,
      ) => {
        handler = callback;
      },
    },
    { provider: "chatgpt-hosted", baseOrigin: target },
    new Set([target]),
    {
      hostedConsentReady: true,
      hostedCatalogReady: true,
      hostedGenerationAttempts: 0,
      hostedGenerationRequests: 0,
      hostedViolations: [],
      hostedProjectValidator,
    },
  );

  let dispatches = 0;
  let aborts = 0;
  const route = {
    request: () => ({
      url: () => `${target}/api/chatgpt/generate`,
      method: () => "POST",
      postDataJSON: () => requestFor(project),
    }),
    continue: async () => {
      dispatches += 1;
    },
    abort: async () => {
      aborts += 1;
    },
  };
  await handler!(route);
  return { dispatches, aborts };
}

describe("hosted project schema validation", () => {
  let validate: (value: unknown) => boolean;

  beforeAll(async () => {
    validate = await loadHostedProjectValidator();
  });

  it("accepts the valid initial project and allows one hosted dispatch", async () => {
    expect(validate(initialProject)).toBe(true);
    await expect(routeThroughGuard(initialProject, validate)).resolves.toEqual({
      dispatches: 1,
      aborts: 0,
    });
  });

  it.each([
    {
      name: "malformed hierarchy",
      project: {
        ...initialProject,
        groups: [
          {
            id: "group",
            label: "Missing parent",
            position: [0, 0, 0],
            parentId: "unknown-group",
          },
        ],
      },
    },
    {
      name: "malformed geometry",
      project: {
        ...initialProject,
        entities: [
          {
            id: "entity",
            label: "Broken shape",
            position: [0, 0, 0],
            geometry: {
              kind: "custom",
              detail: "refined",
              parts: [
                {
                  shape: "invalid",
                  position: [0, 0, 0],
                  scale: [1, 1, 1],
                  color: "#ffffff",
                },
              ],
            },
          },
        ],
      },
    },
  ])("rejects $name before dispatch", async ({ project }) => {
    expect(validate(project)).toBe(false);
    await expect(routeThroughGuard(project, validate)).resolves.toEqual({
      dispatches: 0,
      aborts: 1,
    });
  });
});
