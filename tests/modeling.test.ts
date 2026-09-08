import { expect, it } from "vitest";
import { modelingJobSchema } from "../src/lib/modeling";
const mesh = {
  id: "mesh",
  shape: "mesh",
  color: "#338855",
  vertices: [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
  ],
  faces: [[0, 1, 2]],
};
it("accepts novel mesh data and profile modeling with bounded defaults", () => {
  const job = modelingJobSchema.parse({
    version: 1,
    parts: [
      mesh,
      {
        id: "vase",
        shape: "lathe",
        color: "#ffaa77",
        profile: [
          [0.2, 0],
          [0.5, 1],
          [0.3, 2],
        ],
      },
    ],
  });
  expect(job.parts[0].scale).toEqual([1, 1, 1]);
  expect(job.parts[1].segments).toBe(16);
});
it("rejects code and arbitrary file references at the modeling boundary", () => {
  for (const addition of [
    { python: "print('run')" },
    { filepath: "/etc/passwd" },
    { url: "https://example.com/model.glb" },
  ])
    expect(
      modelingJobSchema.safeParse({
        version: 1,
        parts: [{ ...mesh, ...addition }],
      }).success,
    ).toBe(false);
});
it("rejects invalid topology, duplicate identity and unbounded modifiers", () => {
  for (const parts of [
    [{ ...mesh, faces: [[0, 1, 9]] }],
    [{ ...mesh, faces: [[0, 0, 1]] }],
    [mesh, mesh],
    [{ ...mesh, subdivision: 3 }],
    [{ ...mesh, scale: [0, 1, 1] }],
  ])
    expect(modelingJobSchema.safeParse({ version: 1, parts }).success).toBe(
      false,
    );
});
it("requires valid profile construction input", () => {
  for (const part of [
    { id: "p", shape: "extrude", color: "#ffffff" },
    {
      id: "p",
      shape: "lathe",
      color: "#ffffff",
      profile: [
        [-1, 0],
        [1, 1],
        [0, 2],
      ],
    },
  ])
    expect(
      modelingJobSchema.safeParse({ version: 1, parts: [part] }).success,
    ).toBe(false);
});
it("rejects jobs over the estimated construction budget", () => {
  const result = modelingJobSchema.safeParse({
    version: 1,
    parts: [
      {
        id: "dense-torus",
        shape: "torus",
        color: "#ffffff",
        segments: 64,
        subdivision: 2,
      },
    ],
  });
  expect(result.success).toBe(false);
  if (!result.success)
    expect(
      result.error.issues.some((issue) =>
        issue.message.includes("estimated construction budget"),
      ),
    ).toBe(true);
});
it("rejects lathe depth because its profile supplies height", () => {
  expect(
    modelingJobSchema.safeParse({
      version: 1,
      parts: [
        {
          id: "lathe",
          shape: "lathe",
          color: "#ffffff",
          profile: [
            [0, 0],
            [0.5, 1],
            [0.25, 2],
          ],
          depth: 1,
        },
      ],
    }).success,
  ).toBe(false);
});
