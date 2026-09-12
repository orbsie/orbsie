import { readFileSync } from "node:fs";
import { strFromU8, unzipSync } from "fflate";
import { expect, it } from "vitest";
import {
  horizontalGapToPlatform,
  jumpReachModel,
  movingTargetMotionBound,
  renderedDimensionsMatchSource,
  sourceLandingEvidence,
  touchControlLabel,
  transformedAssetDimensions,
} from "../scripts/lib/flagship-platforms-verifier.mjs";

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
  expect(platform1Contact?.evidence.atContactHeight).toBe(true);
  expect(platform1Contact?.sample.atPerformanceMs).toBeCloseTo(2353.2, 0);
  expect(platform3Contact?.evidence.accepted).toBe(true);
  expect(platform3Contact?.evidence.atContactHeight).toBe(true);
  expect(platform3Contact?.sample.atPerformanceMs).toBeCloseTo(6008.8, 0);
});

it("rejects the touch run's late below-platform sample as a false landing", () => {
  const platform = entityFor("platform-1");
  const rendered = {
    center: [0.010184202056393254, 0.9978124992921948, 5.506432151794433],
    size: transformedAssetDimensions(platform, asset),
  };
  const previous = {
    player: {
      center: [0.4690660116032427, 1.3914451912980363, 5.88994467081237],
    },
    platforms: { "platform-1": rendered },
  };
  const current = {
    player: {
      center: [0.20926244385788717, 1.1677471698402253, 5.724107329830226],
    },
    platforms: { "platform-1": rendered },
  };
  const evidence = sourceLandingEvidence(previous, current, platform, asset);
  expect(evidence.crossedContactHeight).toBe(true);
  expect(evidence.sourceOverlap).toBe(true);
  expect(evidence.atContactHeight).toBe(false);
  expect(evidence.accepted).toBe(false);

  const nearMiss = {
    player: {
      center: [0.20926244385788717, 1.43062499895, 5.724107329830226],
    },
    platforms: { "platform-1": rendered },
  };
  const nearMissEvidence = sourceLandingEvidence(
    previous,
    nearMiss,
    platform,
    asset,
  );
  expect(nearMissEvidence.atContactHeight).toBe(false);
  expect(nearMissEvidence.accepted).toBe(false);
});

it("accepts settled catalog dimensions and rejects the transient formation dimensions", () => {
  const platform = entityFor("platform-1");
  const settled = transformedAssetDimensions(platform, asset);
  expect(settled).toEqual([
    expect.closeTo(1.2504759722, 6),
    expect.closeTo(0.02062499895, 8),
    expect.closeTo(0.57913566, 6),
  ]);
  expect(
    renderedDimensionsMatchSource(
      { size: [1.2504759669, 0.02062499896, 0.5791356564] },
      platform,
      asset,
    ),
  ).toBe(true);
  expect(
    renderedDimensionsMatchSource(
      { size: [1.4, 0.2499999925, 0.7799423218] },
      platform,
      asset,
    ),
  ).toBe(false);
});

it("computes a bounded jump reach from the gameplay movement model", () => {
  const platform = entityFor("platform-2");
  const rendered = {
    center: [2, 0.9978125, 5],
    size: transformedAssetDimensions(platform, asset),
  };
  const reach = jumpReachModel();
  expect(reach.flightTime).toBeCloseTo(0.8, 8);
  expect(reach.maxTravel).toBeCloseTo(3, 8);
  expect(movingTargetMotionBound(platform, reach.flightTime)).toBeCloseTo(
    1.44,
    8,
  );
  expect(
    jumpReachModel({
      margin: 0.2,
      targetMotionMargin: movingTargetMotionBound(platform, reach.flightTime),
    }).maxTravel,
  ).toBeCloseTo(1.56, 8);
  expect(
    horizontalGapToPlatform([0, 1.440625, 5], rendered, platform, asset),
  ).toMatchObject({ reachable: true });
  expect(
    horizontalGapToPlatform([-3, 1.440625, 5], rendered, platform, asset),
  ).toMatchObject({ reachable: false });
});

it("maps gameplay keys to the published player's real touch button labels", () => {
  expect(["w", "a", "s", "d", " "].map(touchControlLabel)).toEqual([
    "Forward",
    "Left",
    "Back",
    "Right",
    "Jump",
  ]);
});
