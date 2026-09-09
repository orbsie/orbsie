import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { blankProject, commandSchema } from "../src/lib/protocol";
import { generationDiagnostic } from "../src/lib/generation-diagnostics";
import { generateCommands } from "../src/lib/server/generation";

const allowedCodes = new Set([
  "invalid_type",
  "too_big",
  "too_small",
  "invalid_format",
  "not_multiple_of",
  "unrecognized_keys",
  "invalid_union",
  "invalid_key",
  "invalid_element",
  "invalid_value",
  "custom",
]);

describe("generation diagnostics", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reports bounded schema paths for a malformed nested recipe", () => {
    let error: unknown;
    try {
      commandSchema.parse({
        type: "set_geometry",
        id: "shape",
        geometry: {
          kind: "generated",
          detail: "refined",
          job: {
            backend: "browser-manifold",
            recipe: {
              version: 1,
              revision: 0,
              output: "profile",
              nodes: [
                {
                  id: "profile",
                  kind: "extrude",
                  profile: [
                    [0, 0],
                    [1, 0],
                    [0, 1],
                    [0, 0],
                  ],
                  depth: 1,
                },
              ],
            },
          },
        },
      });
    } catch (caught) {
      error = caught;
    }
    const diagnostic = generationDiagnostic(error);
    expect(diagnostic?.code).toBe("INVALID_SCENE_UPDATE");
    expect(diagnostic?.diagnostic.operation).toBe(0);
    expect(diagnostic?.diagnostic.issues.length).toBeGreaterThan(0);
    expect(diagnostic?.diagnostic.issues.length).toBeLessThanOrEqual(8);
    expect(diagnostic?.diagnostic.issues).toContainEqual({
      code: "custom",
      path: ["geometry", "job", "recipe", "nodes", 0, "profile"],
    });
    for (const issue of diagnostic?.diagnostic.issues ?? []) {
      expect(allowedCodes.has(issue.code)).toBe(true);
      expect(issue.path.length).toBeLessThanOrEqual(12);
      for (const segment of issue.path)
        if (typeof segment === "number")
          expect(segment).toBeLessThanOrEqual(255);
    }
  });

  it("replaces unknown paths and never exposes issue messages, values, or keys", () => {
    const error = new z.ZodError([
      {
        code: "custom",
        path: ["geometry", "recipe", "privateApiKey", "secretField"],
        message: "do-not-leak-this-message-or-value",
      },
    ]);
    const diagnostic = generationDiagnostic(error);
    expect(diagnostic).toEqual({
      code: "INVALID_SCENE_UPDATE",
      diagnostic: {
        operation: 0,
        issues: [{ code: "custom", path: ["geometry", "recipe", "?", "?"] }],
      },
    });
    expect(JSON.stringify(diagnostic)).not.toContain("privateApiKey");
    expect(JSON.stringify(diagnostic)).not.toContain("do-not-leak");
  });

  it("recurses unions with bounded depth and prioritizes deeper issues", () => {
    const issue = {
      code: "invalid_union",
      path: ["geometry"],
      errors: Array.from({ length: 20 }, (_, branch) => [
        {
          code: "invalid_type",
          path: ["job", branch, "recipe", "nodes", branch, "profile"],
          message: "private union detail",
        },
      ]),
      message: "private union detail",
    };
    const diagnostic = generationDiagnostic(new z.ZodError([issue as never]));
    expect(diagnostic?.diagnostic.issues).toHaveLength(8);
    expect(diagnostic?.diagnostic.issues[0].path.length).toBeGreaterThan(1);
    expect(
      diagnostic?.diagnostic.issues.every(
        (entry) =>
          entry.path.length <= 12 && !JSON.stringify(entry).includes("private"),
      ),
    ).toBe(true);
  });

  it("identifies malformed JSON without exposing parser text", () => {
    let error: unknown;
    try {
      JSON.parse('{"profile":"secret-value"');
    } catch (caught) {
      error = caught;
    }
    expect(generationDiagnostic(error)).toEqual({
      code: "INVALID_SCENE_JSON",
      diagnostic: { operation: 0, issues: [] },
    });
    expect(generationDiagnostic(new Error("private"))).toBeUndefined();
  });

  it("bounds the operation count independently of issue details", () => {
    const error = new z.ZodError([
      { code: "custom", path: [], message: "private" },
    ]);
    expect(generationDiagnostic(error, -4)?.diagnostic.operation).toBe(0);
    expect(generationDiagnostic(error, 1.9)?.diagnostic.operation).toBe(1);
    expect(generationDiagnostic(error, 999)?.diagnostic.operation).toBe(251);
  });

  it("adds only the bounded diagnostic to invalid scene NDJSON", async () => {
    const command = {
      type: "set_geometry",
      id: "shape",
      geometry: {
        kind: "generated",
        detail: "refined",
        job: {
          backend: "browser-manifold",
          recipe: {
            version: 1,
            revision: 0,
            output: "profile",
            nodes: [
              {
                id: "profile",
                kind: "extrude",
                profile: [
                  [0, 0],
                  [1, 0],
                  [0, 1],
                ],
                depth: 1,
                privateApiKey: "provider-secret",
              },
            ],
          },
        },
      },
    };
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(
          `data: ${JSON.stringify({ choices: [{ delta: { content: `${JSON.stringify(command)}\n` } }] })}\n\ndata: [DONE]\n\n`,
          { headers: { "Content-Type": "text/event-stream" } },
        ),
    );
    const stream = await generateCommands({
      provider: "gateway",
      model: "test-model",
      key: "test-key",
      prompt: "make a shape",
      project: blankProject(),
      signal: new AbortController().signal,
    });
    const record = JSON.parse(await new Response(stream).text());
    expect(record.error).toBe(
      "The model returned an invalid scene update. Finished objects are preserved.",
    );
    expect(record.code).toBe("INVALID_SCENE_UPDATE");
    expect(record.diagnostic.operation).toBe(1);
    expect(JSON.stringify(record)).not.toContain("privateApiKey");
    expect(JSON.stringify(record)).not.toContain("provider-secret");
  });
});
