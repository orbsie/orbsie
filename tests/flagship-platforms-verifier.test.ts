import { readFileSync } from "node:fs";
import { strFromU8, unzipSync } from "fflate";
import { Matrix4, Vector3 } from "three";
import { expect, it } from "vitest";
import {
  horizontalGapToPlatform,
  jumpReachModel,
  movingTargetMotionBound,
  findFrameLandingEvidence,
  observedUpwardTakeoff,
  postTakeoffGroundContactFrames,
  renderedDimensionsMatchSource,
  sourcePlatformContact,
  sourceLandingEvidence,
  selectCatalogManifest,
  touchControlLabel,
  touchLaunchKeys,
  transformedAssetDimensions,
  validateFrameTelemetryDrain,
} from "../scripts/lib/flagship-platforms-verifier.mjs";

const zip = unzipSync(
  readFileSync(
    "docs/evidence/provider-e2e/flagship-openrouter/openrouter/world.zip",
  ),
);
const project = JSON.parse(strFromU8(zip["project.json"]));
// These traces belong to this immutable export, whose runtime used its own
// catalog bounds. Current-source geometry is covered by catalog-source-bounds.
const manifest = JSON.parse(strFromU8(zip["assets/catalog/manifest.json"]));
const repositoryManifest = JSON.parse(
  readFileSync("assets/catalog/manifest.json", "utf8"),
);
const asset = manifest.assets.find(
  (candidate: { id: string }) =>
    candidate.id === "kenney.nature.platform-grass",
);
const retained = JSON.parse(
  readFileSync("docs/evidence/flagship-platforms/report.json", "utf8"),
);
const touchSnapshotMismatch = JSON.parse(
  readFileSync(
    "docs/evidence/publication-flagship-openrouter/platforms-sequential-touch-current/report.json",
    "utf8",
  ),
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

function frameSample(
  frameId: number,
  playerY: number,
  rendered = firstSourceContact("platform-1")?.sample.platforms["platform-1"],
) {
  if (!rendered) throw new Error("retained platform-1 frame is missing");
  const center = rendered.center as number[];
  const playerCenter = [center[0], playerY, center[2]];
  const playerBounds = {
    min: [playerCenter[0] - 0.25, playerY - 0.42, playerCenter[2] - 0.25],
    max: [playerCenter[0] + 0.25, playerY + 0.42, playerCenter[2] + 0.25],
  };
  return {
    frameId,
    frameTimestampMs: (frameId * 1000) / 60,
    atPerformanceMs: (frameId * 1000) / 60,
    player: {
      frameId,
      visible: true,
      center: playerCenter,
      runtimeCenter: playerCenter,
      bounds: playerBounds,
      runtimeBounds: playerBounds,
    },
    platforms: {
      "platform-1": {
        ...rendered,
        frameId,
        visible: true,
      },
    },
  };
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

it("validates drained render-frame continuity and same-frame object correlation", () => {
  const contact = firstSourceContact("platform-1");
  if (!contact) throw new Error("retained platform-1 contact is missing");
  const first = frameSample(0, contact.evidence.source!.contactY + 0.05);
  const second = frameSample(1, contact.evidence.source!.contactY);
  const valid = validateFrameTelemetryDrain(
    {
      samples: [first, second],
      droppedSinceLastDrain: 0,
      issue: null,
    },
    -1,
    ["platform-1"],
  );
  expect(valid).toMatchObject({ valid: true, lastFrameId: 1 });

  expect(
    validateFrameTelemetryDrain(
      { samples: [second], droppedSinceLastDrain: 0, issue: null },
      -1,
      ["platform-1"],
    ),
  ).toMatchObject({ valid: false, reason: "nonconsecutive-frame-id" });
  expect(
    validateFrameTelemetryDrain(
      { samples: [second], droppedSinceLastDrain: 1, issue: null },
      0,
      ["platform-1"],
    ),
  ).toMatchObject({ valid: false, reason: "frame-ring-overflow" });
  expect(
    validateFrameTelemetryDrain(
      {
        samples: [
          {
            ...second,
            platforms: {
              "platform-1": { ...second.platforms["platform-1"], frameId: 0 },
            },
          },
        ],
        droppedSinceLastDrain: 0,
        issue: null,
      },
      0,
      ["platform-1"],
    ),
  ).toMatchObject({
    valid: false,
    reason: "platform-frame-id-mismatch-platform-1",
  });
});

it("excludes pre-jump ground frames and captures ground contact after observed takeoff", () => {
  const initialGround = frameSample(30, 0.42);
  const preJumpGround = frameSample(31, 0.42);
  const upwardLaunch = frameSample(32, 0.55);
  const laterGround = frameSample(33, 0.42);

  expect(observedUpwardTakeoff(initialGround, preJumpGround, 0.5)).toBeNull();
  const takeoff = observedUpwardTakeoff(preJumpGround, upwardLaunch, 0.5);
  expect(takeoff).toMatchObject({
    frameId: 32,
    previousFrameId: 31,
    previousCenterY: 0.42,
    centerY: 0.55,
  });
  expect(
    postTakeoffGroundContactFrames(
      [initialGround, preJumpGround, upwardLaunch, laterGround],
      takeoff!.frameId,
      0.5,
    ).map((frame: { frameId: number }) => frame.frameId),
  ).toEqual([33]);
});

it("accepts only strict source contact across adjacent render frames", () => {
  const entity = entityFor("platform-1");
  const contact = firstSourceContact(entity.id);
  if (!contact) throw new Error("retained platform-1 contact is missing");
  const contactY = contact.evidence.source!.contactY;
  const before = frameSample(10, contactY + 0.05);
  const exact = frameSample(11, contactY);
  const accepted = findFrameLandingEvidence(before, [exact], entity, asset);
  expect(accepted.landing?.frameId).toBe(11);
  expect(accepted.evidence?.accepted).toBe(true);
  expect(accepted.evidence?.atContactHeight).toBe(true);

  const lateBelow = frameSample(11, contactY - 0.01);
  expect(
    findFrameLandingEvidence(before, [lateBelow], entity, asset).landing,
  ).toBeNull();
  const gap = frameSample(12, contactY);
  expect(
    findFrameLandingEvidence(before, [gap], entity, asset).landing,
  ).toBeNull();
});

it("uses saved catalog bounds to measure a published touch run from its snapshot", () => {
  const saved = selectCatalogManifest(manifest, repositoryManifest);
  const fallback = selectCatalogManifest(null, repositoryManifest);
  expect(saved.source).toBe("saved ZIP assets/catalog/manifest.json");
  expect(fallback.source).toBe(
    "repository assets/catalog/manifest.json fallback",
  );

  const savedAsset = saved.manifest.assets.find(
    (candidate: { id: string }) =>
      candidate.id === "kenney.nature.platform-grass",
  );
  const currentAsset = fallback.manifest.assets.find(
    (candidate: { id: string }) =>
      candidate.id === "kenney.nature.platform-grass",
  );
  const entity = entityFor("platform-1");
  const stage = touchSnapshotMismatch.runs[0].stages[0];
  const samples = stage.landingSamples;
  const acceptedIndex = samples.findIndex(
    (sample: unknown, index: number) =>
      index > 0 &&
      sourceLandingEvidence(samples[index - 1], sample, entity, savedAsset)
        .accepted,
  );

  expect(touchSnapshotMismatch.inputMode).toBe("mobile-touch");
  expect(touchSnapshotMismatch.runs[0].inputMethod).toBe(
    "mobile CDP multitouch buttons",
  );
  expect(stage.landedAt).toBeNull();
  expect(acceptedIndex).toBeGreaterThan(0);

  const currentSample = samples[acceptedIndex];
  const previousSample = samples[acceptedIndex - 1];
  const savedEvidence = sourceLandingEvidence(
    previousSample,
    currentSample,
    entity,
    savedAsset,
  );
  const fallbackEvidence = sourceLandingEvidence(
    previousSample,
    currentSample,
    entity,
    currentAsset,
  );
  expect(savedEvidence.accepted).toBe(true);
  expect(savedEvidence.currentY).toBeCloseTo(1.440625, 5);
  expect(savedEvidence.source?.contactY).toBeCloseTo(1.440625, 5);
  expect(fallbackEvidence.accepted).toBe(false);
  expect(fallbackEvidence.source?.contactY).toBeCloseTo(1.428125, 5);
});

it("uses the rendered runtime matrix when a game action changes platform height", () => {
  const platform = entityFor("platform-1");
  const runtimeMatrix = new Matrix4()
    .makeTranslation(-1, 1.2, 5)
    .scale(new Vector3(1.5, 1, 1));
  const rendered = {
    center: [-1, 1.24125, 5],
    size: transformedAssetDimensions(platform, asset),
    runtimeMatrix: runtimeMatrix.toArray(),
  };
  const evidence = sourceLandingEvidence(
    {
      player: {
        center: [-0.8, 1.78, 5.1],
        runtimeCenter: [-1, 1.78, 5],
      },
      platforms: { "platform-1": rendered },
    },
    {
      player: {
        center: [-0.8, 1.702499, 5.1],
        runtimeCenter: [-1, 1.702499, 5],
      },
      platforms: { "platform-1": rendered },
    },
    platform,
    asset,
  );
  expect(evidence.source?.contactModel).toBe("runtime-matrix-support-surface");
  expect(evidence.source?.runtimeSurfaceY).toBeCloseTo(1.2825, 8);
  expect(evidence.source?.contactY).toBeCloseTo(1.7025, 8);
  expect(evidence.accepted).toBe(true);
});

it("rejects an authored-height sample when the runtime platform pose moved", () => {
  const platform = entityFor("platform-1");
  const runtimeMatrix = new Matrix4()
    .makeTranslation(-1, 1.2, 5)
    .scale(new Vector3(1.5, 1, 1));
  const renderedRuntime = {
    center: [-1, 1.24125, 5],
    size: transformedAssetDimensions(platform, asset),
    runtimeMatrix: runtimeMatrix.toArray(),
  };
  const authoredContactY =
    platform.position[1] + asset.bounds.max[1] * platform.scale[1] + 0.42;
  const previous = { player: { center: [-1, authoredContactY + 0.05, 5] } };
  const current = {
    player: { center: [-1, authoredContactY - 0.000001, 5] },
  };
  const movedEvidence = sourceLandingEvidence(
    previous,
    { ...current, platforms: { "platform-1": renderedRuntime } },
    platform,
    asset,
  );
  expect(movedEvidence.source?.contactY).toBeCloseTo(1.7025, 8);
  expect(movedEvidence.accepted).toBe(false);

  const authoredEvidence = sourceLandingEvidence(
    previous,
    {
      ...current,
      platforms: {
        "platform-1": { ...renderedRuntime, runtimeMatrix: undefined },
      },
    },
    platform,
    asset,
  );
  expect(authoredEvidence.source?.contactY).toBeCloseTo(authoredContactY, 8);
  expect(authoredEvidence.accepted).toBe(true);
});

it("rejects malformed runtime matrices instead of falling back to authored contact", () => {
  const platform = entityFor("platform-1");
  const malformedMatrix = new Matrix4().makeTranslation(-1, 1.2, 5).toArray();
  malformedMatrix[15] = 2;
  expect(
    sourcePlatformContact(
      platform,
      {
        center: [-1, 1.24125, 5],
        runtimeMatrix: malformedMatrix,
      },
      asset,
    ),
  ).toBeNull();
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

it("orders touch platform launch input with Jump before directional movement", () => {
  expect(touchLaunchKeys(["d"])).toEqual([" ", "d"]);
  expect(touchLaunchKeys(["a", "w"])).toEqual([" ", "a", "w"]);
});
