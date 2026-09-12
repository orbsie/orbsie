import { readFileSync } from "node:fs";
import { strFromU8, unzipSync } from "fflate";
import { expect, it } from "vitest";
import { sourceLandingEvidence } from "../scripts/lib/flagship-platforms-verifier.mjs";

const zip = unzipSync(
  readFileSync(
    "docs/evidence/provider-e2e/flagship-openrouter/openrouter/world.zip",
  ),
);
const project = JSON.parse(strFromU8(zip["project.json"]));
const manifest = JSON.parse(
  readFileSync("assets/catalog/manifest.json", "utf8"),
);
const asset = manifest.assets.find(
  (candidate: { id: string }) =>
    candidate.id === "kenney.nature.platform-grass",
);
const retained = JSON.parse(
  readFileSync("docs/evidence/flagship-platforms/report.json", "utf8"),
);

if (!asset) throw new Error("retained flagship catalog asset is missing");

function entityFor(id: string) {
  const entity = project.entities.find(
    (candidate: { id: string }) => candidate.id === id,
  );
  if (!entity) throw new Error(`retained entity ${id} is missing`);
  return entity;
}

function sequenceFor(id: string) {
  const run = retained.runs.find(
    (candidate: { id: string }) => candidate.id === id,
  );
  if (!run) throw new Error(`retained run ${id} is missing`);
  return [run.beforeJump, ...run.landingSamples, ...run.carrySamples].filter(
    Boolean,
  );
}

function firstSourceContact(id: string) {
  const entity = entityFor(id);
  const samples = sequenceFor(id);
  for (let index = 1; index < samples.length; index++) {
    const evidence = sourceLandingEvidence(
      samples[index - 1],
      samples[index],
      entity,
      asset,
    );
    if (evidence.accepted) return { sample: samples[index], evidence, index };
  }
  return null;
}

it("rejects platform2's retained airborne release while accepting source contact on platforms1 and 3", () => {
  const platform2 = entityFor("platform-2");
  const platform2Run = retained.runs.find(
    (candidate: { id: string }) => candidate.id === "platform-2",
  );
  const platform2Samples = sequenceFor("platform-2");
  const oldReleaseIndex = platform2Samples.findIndex(
    (sample: { atPerformanceMs: number }) =>
      sample.atPerformanceMs === platform2Run.landedAt.atPerformanceMs,
  );
  expect(oldReleaseIndex).toBeGreaterThan(0);
  const oldRelease = sourceLandingEvidence(
    platform2Samples[oldReleaseIndex - 1],
    platform2Samples[oldReleaseIndex],
    platform2,
    asset,
  );
  expect(oldRelease.accepted).toBe(false);
  expect(oldRelease.sourceOverlap).toBe(true);
  expect(oldRelease.crossedContactHeight).toBe(false);
  expect(firstSourceContact("platform-2")).toBeNull();

  const platform1Contact = firstSourceContact("platform-1");
  const platform3Contact = firstSourceContact("platform-3");
  expect(platform1Contact?.evidence.accepted).toBe(true);
  expect(platform1Contact?.sample.atPerformanceMs).toBeCloseTo(2353.2, 0);
  expect(platform3Contact?.evidence.accepted).toBe(true);
  expect(platform3Contact?.sample.atPerformanceMs).toBeCloseTo(6008.8, 0);
});
