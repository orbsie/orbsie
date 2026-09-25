import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  FRESH_GAMEPLAY_LIMITS,
  buildFreshGameplayTargets,
  chooseGameplayKeys,
  chooseGameplayJumpKeys,
  chooseGameplayPlatformLandingPoint,
  chooseGameplayPlatformAction,
  chooseGameplaySteeringKeys,
  detectDescendingPlatformSurfaceCrossing,
  enterFreshGameplayLayoutMode,
  generationStreamIsOpen,
  gameplayJumpPhase,
  gameplayPlatformSurfaceHeight,
  gameplaySupportId,
  gameplaySurfaceCandidatePoints,
  observePlatformContact,
  orderFreshGameplayCollectiblesFromSupport,
  portalCompletionIsAuthoritative,
  retainFreshGameplayJumpSample,
  validateGenerationMovementObservation,
  validateFreshGameplayObservation,
  waitForFreshGameplayObservation,
} from "../scripts/lib/fresh-flagship-gameplay.mjs";
import { publishGameplayObservation } from "../src/lib/gameplay-observation";
import { stepGameplay } from "../src/lib/gameplay";

const project = {
  id: "fresh-project",
  revision: 3,
  entities: [
    ...["platform-a", "platform-b", "platform-c"].map((id, index) => ({
      id,
      stage: "ready",
      position: [index, 0, 0],
      scale: [1, 1, 1],
      behavior: { type: index === 1 ? "bounce" : "move" },
    })),
    ...["crystal-a", "crystal-b", "crystal-c", "crystal-d", "crystal-e"].map(
      (id, index) => ({
        id,
        stage: "ready",
        position: [index, 0, 1],
        scale: [1, 1, 1],
        behavior: { type: "collect" },
      }),
    ),
    {
      id: "portal",
      stage: "ready",
      position: [0, 0, -1],
      scale: [1, 1, 1],
      behavior: { type: "portal" },
    },
  ],
};

const story = {
  platforms: project.entities.slice(0, 3),
  collectibles: project.entities.slice(3, 8),
  portal: project.entities[8],
};

function targetsFromPinnedStory(path: string) {
  const saved = JSON.parse(readFileSync(path, "utf8"));
  const spawn = saved.game?.spawn ?? [0, 0, 5];
  const distanceSquared = (from: number[], to: number[]) =>
    from.reduce((sum, component, axis) => sum + (component - to[axis]) ** 2, 0);
  const candidates = saved.entities.filter(
    (entity: any) =>
      entity.stage === "ready" &&
      entity.geometry?.kind === "platform" &&
      ["move", "bounce"].includes(entity.behavior?.type),
  );
  const platforms: any[] = [];
  let anchor: number[] = spawn;
  while (candidates.length > 0) {
    candidates.sort(
      (a: any, b: any) =>
        distanceSquared(anchor, a.position) -
          distanceSquared(anchor, b.position) || a.id.localeCompare(b.id),
    );
    const next = candidates.shift();
    platforms.push(next);
    anchor = next.position;
  }
  const storyTargets = {
    platforms,
    collectibles: saved.entities.filter(
      (entity: any) =>
        entity.stage === "ready" && entity.behavior?.type === "collect",
    ),
    portal: saved.entities.find(
      (entity: any) =>
        entity.stage === "ready" && entity.behavior?.type === "portal",
    ),
  };
  return buildFreshGameplayTargets(saved, storyTargets);
}

afterEach(() => {
  delete (globalThis as any).__ORBSIE_GAMEPLAY_READ_REQUESTED__;
  delete (globalThis as any).__ORBSIE_GAMEPLAY_READ__;
});

describe("fresh flagship gameplay driver", () => {
  it("keeps first and recent bounded platform jump samples", () => {
    let samples: Array<{ index: number; privateText: string }> = [];
    for (let index = 0; index < 30; index++)
      samples = retainFreshGameplayJumpSample(samples, {
        index,
        privateText: "must be removed by the report sanitizer",
      });

    expect(samples).toHaveLength(12);
    expect(samples.map((sample) => sample.index)).toEqual([
      0, 1, 2, 3, 22, 23, 24, 25, 26, 27, 28, 29,
    ]);
  });

  it("brackets descending estimated surface crossings", () => {
    const target = {
      id: "platform-c",
      position: [0, 0.5, 0],
      scale: [2, 0.5, 3],
      geometry: { kind: "platform" },
    };
    const previous = {
      atMs: 100,
      player: { position: [0.4, 1.3, 0.5], velocityY: 0.2 },
      platform: { position: [0, 0.5, 0], scale: [2, 0.5, 3] },
      platformContactCount: 0,
      bounceContactCount: 0,
    };
    const current = {
      atMs: 150,
      player: { position: [0.8, 1.1, 1.8], velocityY: -0.4 },
      platform: { position: [0.1, 0.5, 0.1], scale: [2, 0.5, 3] },
      platformContactCount: 1,
      bounceContactCount: 0,
    };

    expect(
      detectDescendingPlatformSurfaceCrossing(previous, current, target),
    ).toMatchObject({
      kind: "descending-estimated-platform-top-crossing",
      estimateOnly: true,
      footprint: {
        model: "procedural-xz-half-extents-0.55-times-scale",
        authoritativeContact: false,
      },
      previous: {
        estimatedTopY: 1.18,
        insideEstimatedFootprint: true,
      },
      current: {
        estimatedTopY: 1.18,
        insideEstimatedFootprint: false,
      },
      contactCountersChanged: { platform: true, bounce: false },
    });
    expect(
      detectDescendingPlatformSurfaceCrossing(
        previous,
        {
          ...current,
          player: { ...current.player, position: [0.8, 1.2, 1.8] },
        },
        target,
      ),
    ).toBeNull();
  });

  it("steers the pinned rev29 descending crossing onto the safe near side", () => {
    const saved = JSON.parse(
      readFileSync(
        "docs/evidence/provider-e2e/openrouter-flagship-gpt6-luna-live-20260925-recheck/openrouter/story-created-project.json",
        "utf8",
      ),
    );
    const report = JSON.parse(
      readFileSync(
        "docs/evidence/provider-e2e/openrouter-flagship-revision29-bounce1-anchor-path-collectible-priority-replay-20260925/report.json",
        "utf8",
      ),
    );
    const platform = saved.entities.find(
      (entity: any) => entity.id === "bounce-3",
    );
    const crossing =
      report.flagshipStory.phases.creation.gameplay.failureEvidence.platformEvidence.find(
        (entry: any) => entry.id === platform.id,
      ).jumpEvidence[0].surfaceCrossing;
    const observation = crossing.current.observation;
    const target = chooseGameplayPlatformLandingPoint(
      observation.player.position,
      platform,
      observation.platform.position,
    );

    expect(crossing.previous.observation.player.position).toEqual([
      0.5050940018087818, 3.2815786000259473, -4.961438377508168,
    ]);
    expect(observation.player.position[2]).toBeCloseTo(-5.114966318305735);
    expect(crossing.current.insideEstimatedFootprint).toBe(false);
    expect(target?.[0]).toBeCloseTo(observation.player.position[0]);
    expect(target?.[2]).toBeCloseTo(-5.295);
    expect(target?.[2]).toBeLessThan(observation.player.position[2]);
    expect(
      Math.abs(target![0] - observation.platform.position[0]),
    ).toBeLessThanOrEqual(0.55 * platform.scale[0] - 0.12);
    expect(
      Math.abs(target![2] - observation.platform.position[2]),
    ).toBeLessThanOrEqual(0.55 * platform.scale[2] - 0.12);
  });

  it("clamps to a rotated platform's near side and preserves safe inside aims", () => {
    const rotatedPlatform = {
      id: "turned-platform",
      geometry: { kind: "platform" },
      position: [10, 1, 20],
      scale: [2, 1, 4],
      rotation: [0, Math.PI / 2, 0],
    };
    const rotatedAim = chooseGameplayPlatformLandingPoint(
      [12.5, 2, 20],
      rotatedPlatform,
      rotatedPlatform.position,
    );
    expect(rotatedAim?.[0]).toBeCloseTo(12.08);
    expect(rotatedAim?.[2]).toBeCloseTo(20);

    const platform = {
      ...rotatedPlatform,
      position: [0, 1, 0],
      scale: [1, 1, 2],
      rotation: [0, 0, 0],
    };
    const outsideAim = chooseGameplayPlatformLandingPoint(
      [100, 2, -100],
      platform,
      platform.position,
    );
    expect(outsideAim?.[0]).toBeCloseTo(0.43);
    expect(outsideAim?.[2]).toBeCloseTo(-0.98);

    const insideAim = chooseGameplayPlatformLandingPoint(
      [0.2, 2, 0.4],
      platform,
      platform.position,
    );
    expect(insideAim?.[0]).toBeCloseTo(0.2);
    expect(insideAim?.[2]).toBeCloseTo(0.4);
    expect(
      chooseGameplayPlatformLandingPoint(
        [0, 0, 0],
        { ...platform, geometry: { kind: "asset" } },
        platform.position,
      ),
    ).toBeNull();
  });

  it("binds dynamic target IDs and layout to the current project", () => {
    const targets = buildFreshGameplayTargets(project, story);
    expect(targets.platforms.map((target: any) => target.id)).toEqual([
      "platform-a",
      "platform-b",
      "platform-c",
    ]);
    expect(targets.collectibles).toHaveLength(5);
    expect(targets.portal.id).toBe("portal");
    expect(targets.platforms[1].position).toEqual([1, 0, 0]);
  });

  it("prioritizes rev29's elevated crystal-five immediately after bounce-three", () => {
    const targets = targetsFromPinnedStory(
      "docs/evidence/provider-e2e/openrouter-flagship-gpt6-luna-live-20260925-recheck/openrouter/story-created-project.json",
    );
    const sourceIds = targets.collectibles.map((target: any) => target.id);
    const finalSupport = targets.platforms.at(-1);
    const ordered = orderFreshGameplayCollectiblesFromSupport(
      targets.collectibles,
      finalSupport.position,
    );

    expect(targets.platforms.map((target: any) => target.id)).toEqual([
      "bounce-1",
      "bounce-2",
      "bounce-3",
    ]);
    expect(ordered.map((target: any) => target.id)).toEqual([
      "crystal-5",
      "crystal-4",
      "crystal-3",
      "crystal-2",
      "crystal-1",
    ]);
    expect(ordered.map((target: any) => target.id).sort()).toEqual(
      [...sourceIds].sort(),
    );
    expect(targets.collectibles.map((target: any) => target.id)).toEqual(
      sourceIds,
    );
  });

  it("orders rev31's pickups relative to its final support while preserving all five", () => {
    const targets = targetsFromPinnedStory(
      "docs/evidence/provider-e2e/openrouter-flagship-current-20260925/openrouter/story-created-project.json",
    );
    const finalSupport = targets.platforms.at(-1);
    const ordered = orderFreshGameplayCollectiblesFromSupport(
      targets.collectibles,
      finalSupport.position,
    );

    expect(targets.platforms.map((target: any) => target.id)).toEqual([
      "bounce-one",
      "bounce-two",
      "bounce-three",
    ]);
    expect(ordered.map((target: any) => target.id)).toEqual([
      "crystal-five",
      "crystal-four",
      "crystal-three",
      "crystal-two",
      "crystal-one",
    ]);
    expect(new Set(ordered.map((target: any) => target.id)).size).toBe(5);
  });

  it("uses support-relative height and 3D distance, independent of IDs and horizontal orientation", () => {
    const support = [0, 2, 0];
    const pickups = [
      {
        id: "z-first",
        semantic: "lower-near",
        position: [0, 1, 0.1],
      },
      {
        id: "a-first",
        semantic: "elevated-near",
        position: [1, 2, 0],
      },
      {
        id: "m-first",
        semantic: "elevated-far",
        position: [4, 2, 0],
      },
    ];
    const ordered = orderFreshGameplayCollectiblesFromSupport(pickups, support);
    const rotateTranslate = ([x, y, z]: number[]) => [z + 20, y, -x - 40];
    const transformedOrder = orderFreshGameplayCollectiblesFromSupport(
      pickups.map((pickup, index) => ({
        ...pickup,
        id: `renamed-${pickups.length - index}`,
        position: rotateTranslate(pickup.position),
      })),
      rotateTranslate(support),
    );

    expect(ordered.map((pickup) => pickup.semantic)).toEqual([
      "elevated-near",
      "elevated-far",
      "lower-near",
    ]);
    expect(transformedOrder.map((pickup) => pickup.semantic)).toEqual(
      ordered.map((pickup) => pickup.semantic),
    );
  });

  it("resolves all seven collectibles from the selected saved revision", () => {
    const added = ["crystal-f", "crystal-g"].map((id, index) => ({
      id,
      stage: "ready",
      position: [8 + index, 2, -3],
      scale: [1, 1, 1],
      behavior: { type: "collect" },
    }));
    const goal7 = {
      ...project,
      revision: project.revision + 1,
      entities: [...project.entities, ...added],
    };
    const currentStory = {
      ...story,
      collectibles: goal7.entities.filter(
        (entity: any) => entity.behavior?.type === "collect",
      ),
    };
    const targets = buildFreshGameplayTargets(goal7, currentStory, {
      expectedCollectibleCount: 7,
      expectedRevision: goal7.revision,
    });
    expect(targets.collectibles.map((target: any) => target.id)).toHaveLength(
      7,
    );
    expect(
      targets.collectibles.slice(-2).map((target: any) => target.position),
    ).toEqual([
      [8, 2, -3],
      [9, 2, -3],
    ]);
  });

  it("rejects wrong objective counts, stale IDs, and revision mismatches", () => {
    expect(() =>
      buildFreshGameplayTargets(project, story, {
        expectedCollectibleCount: 7,
      }),
    ).toThrow(/expected 7 collectibles/);
    expect(() =>
      buildFreshGameplayTargets(project, story, {
        expectedCollectibleCount: 6 as any,
      }),
    ).toThrow(/must be five or seven/);
    expect(() =>
      buildFreshGameplayTargets(project, {
        ...story,
        collectibles: [
          { ...story.collectibles[0], id: "stale-crystal" },
          ...story.collectibles.slice(1),
        ],
      }),
    ).toThrow(/is not in the project/);
    expect(() =>
      buildFreshGameplayTargets(project, story, {
        expectedRevision: project.revision + 1,
      }),
    ).toThrow(/revision does not match/);
  });

  it("steers using the runtime camera-relative movement keys", () => {
    expect(chooseGameplayKeys([0, 0, 0], [0, 0, -1])).toEqual(["d", "w"]);
    expect(chooseGameplayKeys([0, 0, 0], [0, 0, 1])).toEqual(["a", "s"]);
  });

  it("keeps gameplay focus candidates inset and inside narrow surface bounds", () => {
    const points = gameplaySurfaceCandidatePoints({
      x: 0,
      y: 0,
      width: 320,
      height: 240,
    });
    expect(points.length).toBeGreaterThan(4);
    expect(
      points.every(
        ({ x, y }: { x: number; y: number }) =>
          x > 0 && x < 320 && y > 0 && y < 240,
      ),
    ).toBe(true);
  });

  it("keeps the jump edge while releasing horizontal steering at center", () => {
    expect(chooseGameplayJumpKeys([0, 0, 0], [0.1, 0, 0.1])).toEqual([" "]);
    expect(chooseGameplayJumpKeys([0, 0, 0], [0, 0, -1])).toEqual([
      " ",
      "d",
      "w",
    ]);
  });

  it("routes elevated transitions from stable support and releases jump steering", () => {
    const support = {
      player: {
        position: [0, 0.93, 3],
        velocityY: 0,
        groundedOn: "platform-a",
      },
    };
    const elevated = {
      id: "platform-b",
      position: [0, 0.8, 0.3],
      scale: [1.6, 0.7, 1.6],
    };
    expect(gameplayJumpPhase(support)).toBe("supported");
    expect(gameplaySupportId(support)).toBe("platform-a");
    expect(gameplayPlatformSurfaceHeight(elevated)).toBeCloseTo(1.584);
    expect(
      chooseGameplayPlatformAction({
        observation: support,
        target: elevated,
      }),
    ).toEqual({ phase: "jumping", keys: [" ", "d", "w"] });
    const airborne = {
      player: { position: [0, 1.3, 2], velocityY: 3 },
    };
    expect(gameplayJumpPhase(airborne)).toBe("ascending");
    expect(
      chooseGameplayPlatformAction({
        observation: airborne,
        target: elevated,
      }).keys,
    ).not.toContain(" ");
    expect(
      chooseGameplayPlatformAction({
        observation: support,
        target: elevated,
        jumping: true,
      }),
    ).toEqual({ phase: "recovered", keys: [] });
    expect(chooseGameplaySteeringKeys([0, 0, 0], [0.1, 0, 0.1])).toEqual([]);
  });

  it("requires a real bounce event instead of nearby upward motion", () => {
    const target = { id: "platform", position: [0, 0, 0], scale: [1, 1, 1] };
    expect(
      observePlatformContact(
        { player: { velocityY: 0 } },
        { player: { velocityY: 6, position: [0, 0.9, 0] } },
        target,
      ).bounced,
    ).toBe(false);
    expect(
      observePlatformContact(
        { bounceContactCounts: {} },
        {
          player: { velocityY: 6, position: [4, 4, 4] },
          bounceContactCounts: { platform: 1 },
        },
        target,
      ).bounced,
    ).toBe(true);
  });

  it("uses the stream control as generation-in-progress evidence", () => {
    expect(generationStreamIsOpen({ stopControlVisible: true })).toBe(true);
    expect(generationStreamIsOpen({ stopControlVisible: false })).toBe(false);
  });

  it("enters gameplay before layout checks and keeps an active run playing", async () => {
    const makePage = (initialMode: "editing" | "playing") => {
      let mode = initialMode;
      const calls: string[] = [];
      const page = {
        getByRole: (_role: string, { name }: { name: string }) => ({
          isVisible: async () =>
            (name === "Play" && mode === "editing") ||
            (name === "Edit" && mode === "playing"),
          click: async () => {
            calls.push(name);
            mode = name === "Play" ? "playing" : "editing";
          },
        }),
      };
      return { page, calls, mode: () => mode };
    };

    const afterEdit = makePage("editing");
    expect(await enterFreshGameplayLayoutMode(afterEdit.page)).toBe("started");
    expect(afterEdit.calls).toEqual(["Play"]);
    expect(afterEdit.mode()).toBe("playing");

    const afterGameplay = makePage("playing");
    expect(await enterFreshGameplayLayoutMode(afterGameplay.page)).toBe(
      "already-playing",
    );
    expect(afterGameplay.calls).toEqual([]);
    expect(afterGameplay.mode()).toBe("playing");
  });

  it("waits through a stale generation frame and samples a newer frame", async () => {
    const stale = { atMs: 10 };
    const fresh = { atMs: 20 };
    let reads = 0;
    const sample = await waitForFreshGameplayObservation(
      async () => (reads++ === 0 ? stale : fresh),
      async () => {},
      { lastAtMs: 10, maxWaitMs: 100 },
    );
    expect(sample.observation).toBe(fresh);
    expect(sample.polls).toBe(1);
  });

  it("accepts a fresh gameplay frame delivered after a 1s RAF gap", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(0);
      const stale = { atMs: 10 };
      const fresh = { atMs: 20 };
      let reads = 0;
      const sample = await waitForFreshGameplayObservation(
        async () => (reads++ < 25 ? stale : fresh),
        async (delayMs: number) => {
          await vi.advanceTimersByTimeAsync(delayMs);
        },
        { lastAtMs: stale.atMs },
      );
      expect(sample.observation).toBe(fresh);
      expect(sample.waitedMs).toBe(1250);
      expect(sample.polls).toBe(25);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects a stream movement claim when no newer frame arrives", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(0);
      const stale = { atMs: 10 };
      const sample = await waitForFreshGameplayObservation(
        async () => stale,
        async (delayMs: number) => {
          await vi.advanceTimersByTimeAsync(delayMs);
        },
        { lastAtMs: 10 },
      );
      expect(sample.observation).toBeNull();
      expect(sample.waitedMs).toBe(FRESH_GAMEPLAY_LIMITS.maxObservationWaitMs);
      expect(sample.polls).toBe(60);
      const validation = validateGenerationMovementObservation(
        {
          projectId: "project",
          revision: 2,
          renderer: "webgl",
          atMs: 10,
          player: { position: [0, 0, 0] },
        },
        sample.observation,
        {
          projectId: "project",
          streamOpenBefore: true,
          streamOpenAfter: true,
        },
      );
      expect(validation.valid).toBe(false);
      expect(validation.failures).toContain("missing-after-observation");
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects nonplaying and nonfinite generation movement samples", () => {
    const before = {
      projectId: "project",
      revision: 2,
      renderer: "webgl",
      playing: true,
      atMs: 10,
      player: { position: [0, 0, 0] },
    };
    const after = {
      ...before,
      atMs: 20,
      player: { position: [0, 0, -1] },
    };
    expect(
      validateGenerationMovementObservation(
        before,
        {
          ...after,
          playing: false,
        },
        {
          projectId: "project",
          streamOpenBefore: true,
          streamOpenAfter: true,
        },
      ).failures,
    ).toContain("after-sample-not-playing");
    expect(
      validateGenerationMovementObservation(
        before,
        {
          ...after,
          player: { position: [Number.NaN, 0, -1] },
        },
        {
          projectId: "project",
          streamOpenBefore: true,
          streamOpenAfter: true,
        },
      ).failures,
    ).toContain("movement-distance-nonfinite");
  });

  it("requires authoritative portal contact and the full score after a near arrival", () => {
    const observation = {
      projectId: project.id,
      revision: project.revision,
      renderer: "webgl",
      player: { position: [-0.35, 0.42, -4.76] },
      contacts: ["portal"],
      scoreIds: [
        "crystal-a",
        "crystal-b",
        "crystal-c",
        "crystal-d",
        "crystal-e",
      ],
      status: "won",
      won: true,
    };
    const nearPortalWithoutContact = {
      ...observation,
      player: { position: [0, 0.42, -1.1] },
      contacts: [],
      status: "playing",
      won: false,
    };
    expect(
      portalCompletionIsAuthoritative(nearPortalWithoutContact, {
        portalId: "portal",
        expectedCollectibleIds: story.collectibles.map(
          (target: any) => target.id,
        ),
      }),
    ).toBe(false);
    expect(
      portalCompletionIsAuthoritative(observation, {
        portalId: "portal",
        expectedCollectibleIds: story.collectibles.map(
          (target: any) => target.id,
        ),
      }),
    ).toBe(true);
    expect(
      portalCompletionIsAuthoritative(
        { ...observation, scoreIds: observation.scoreIds.slice(1) },
        {
          portalId: "portal",
          expectedCollectibleIds: story.collectibles.map(
            (target: any) => target.id,
          ),
        },
      ),
    ).toBe(false);
  });

  it("rejects stale, foreign, and renderer-switched samples", () => {
    const sample = {
      projectId: "project",
      revision: 2,
      renderer: "software",
      atMs: 20,
    };
    expect(
      validateFreshGameplayObservation(sample, {
        projectId: "project",
        revision: 2,
        renderer: "software",
        lastAtMs: 10,
      }),
    ).toBe(sample);
    expect(() =>
      validateFreshGameplayObservation(sample, {
        projectId: "other",
        revision: 2,
        renderer: "software",
        lastAtMs: 10,
      }),
    ).toThrow(/identity or revision/);
    expect(() =>
      validateFreshGameplayObservation(sample, {
        projectId: "project",
        revision: 2,
        renderer: "webgl",
        lastAtMs: 10,
      }),
    ).toThrow(/renderer changed/);
    expect(() =>
      validateFreshGameplayObservation(sample, {
        projectId: "project",
        revision: 2,
        renderer: "software",
        lastAtMs: 20,
      }),
    ).toThrow(/stale/);
    expect(() =>
      validateFreshGameplayObservation(
        { ...sample, reset: 1, sessionGeneration: 0 },
        {
          projectId: "project",
          revision: 2,
          renderer: "software",
          lastAtMs: 10,
          reset: 0,
          sessionGeneration: 0,
        },
      ),
    ).toThrow(/reset changed/);
    expect(() =>
      validateFreshGameplayObservation(
        { ...sample, reset: 0, sessionGeneration: 1 },
        {
          projectId: "project",
          revision: 2,
          renderer: "software",
          lastAtMs: 10,
          reset: 0,
          sessionGeneration: 0,
        },
      ),
    ).toThrow(/session changed/);
    expect(
      validateFreshGameplayObservation(
        { ...sample, reset: 1, sessionGeneration: 1 },
        {
          projectId: "project",
          revision: 2,
          renderer: "software",
          lastAtMs: 10,
          reset: 0,
          sessionGeneration: 0,
          allowLifecycleChange: true,
        },
      ),
    ).toMatchObject({ reset: 1, sessionGeneration: 1 });
  });

  it("copies and accumulates opt-in observations without exposing mutators", () => {
    (globalThis as any).__ORBSIE_GAMEPLAY_READ_REQUESTED__ = true;
    const first = {
      renderer: "software" as const,
      projectId: "project",
      revision: 1,
      simulationDeltaMs: 16,
      playing: true,
      player: {
        position: [0, 0.5, 5] as [number, number, number],
        velocityY: 0,
      },
      entities: [],
      contacts: [],
      platformContactId: "platform",
      bounceContactId: "platform",
      collected: [],
      scoreIds: [],
      gameScore: 0,
      status: "playing" as const,
      won: false,
      lost: false,
      reset: 0,
      sessionGeneration: 0,
    };
    publishGameplayObservation(first);
    const read = () => (globalThis as any).__ORBSIE_GAMEPLAY_READ__();
    const snapshot = read();
    publishGameplayObservation({
      ...first,
      platformContactId: "platform",
      bounceContactId: undefined,
    });
    const accumulated = read();
    expect(accumulated.platformContactCounts.platform).toBe(2);
    expect(accumulated.bounceContactCounts.platform).toBe(1);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.player)).toBe(true);
    first.player.position[0] = 99;
    expect(snapshot.player.position[0]).toBe(0);
    expect("set" in snapshot).toBe(false);
    publishGameplayObservation({ ...first, revision: 2 });
    expect(read().platformContactCounts.platform).toBe(1);
  });

  it("counts legal constructor and prototype-looking IDs independently", () => {
    (globalThis as any).__ORBSIE_GAMEPLAY_READ_REQUESTED__ = true;
    const base = {
      renderer: "software" as const,
      projectId: "dictionary-project",
      revision: 1,
      simulationDeltaMs: 16,
      playing: true,
      player: {
        position: [0, 0.5, 5] as [number, number, number],
        velocityY: 0,
      },
      entities: [],
      contacts: [],
      collected: [],
      scoreIds: [],
      gameScore: 0,
      status: "playing" as const,
      won: false,
      lost: false,
      reset: 0,
      sessionGeneration: 0,
    };
    for (const id of ["constructor", "__proto__", "toString"])
      publishGameplayObservation({
        ...base,
        platformContactId: id,
        bounceContactId: id,
      });
    const snapshot = (globalThis as any).__ORBSIE_GAMEPLAY_READ__();
    for (const id of ["constructor", "__proto__", "toString"]) {
      expect(snapshot.platformContactCounts[id]).toBe(1);
      expect(snapshot.bounceContactCounts[id]).toBe(1);
    }
    expect(Object.getPrototypeOf(snapshot.platformContactCounts)).toBeNull();
    expect(Object.getPrototypeOf(snapshot.bounceContactCounts)).toBeNull();
  });
});

describe("authoritative bounce event", () => {
  const platform = {
    id: "bounce",
    label: "Bounce platform",
    stage: "ready" as const,
    position: [0, 0, 0] as [number, number, number],
    scale: [1, 1, 1] as [number, number, number],
    color: "#ffffff",
    behavior: { type: "bounce" as const },
    geometry: { kind: "platform" as const, detail: "refined" as const },
  };

  it("emits only the selected top-surface bounce", () => {
    const result = stepGameplay(
      { position: [0, 0.96, 0], velocityY: -2 },
      { x: 0, z: 0, jump: false },
      [platform],
      [],
      0,
      0.02,
    );
    expect(result.bounceContactId).toBe(platform.id);
    expect(result.platformContactId).toBe(platform.id);
    expect(result.velocityY).toBeGreaterThan(5);
  });

  it("does not report a lower bounce when a higher platform is selected", () => {
    const higher = {
      ...platform,
      id: "higher",
      position: [0, 0.5, 0] as [number, number, number],
      behavior: { type: "move" as const },
    };
    const result = stepGameplay(
      { position: [0, 1.45, 0], velocityY: -2 },
      { x: 0, z: 0, jump: false },
      [platform, higher],
      [],
      0,
      0.02,
    );
    expect(result.platformContactId).toBe(higher.id);
    expect(result.bounceContactId).toBeUndefined();
  });
});
