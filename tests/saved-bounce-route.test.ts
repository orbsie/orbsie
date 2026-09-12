import { describe, expect, it } from "vitest";
import {
  bounceStageTransition,
  groundSamplesAfter,
  jumpDownEventsAfter,
  platformFootprintSteeringNeeded,
  sequentialRouteAnalysis,
} from "../scripts/lib/saved-bounce-route.mjs";

const asset = {
  bounds: {
    min: [-0.445000023, 0, -0.3539196],
    max: [0.4481971, 0.0824999958, 0.369999975],
  },
};
const entity = {
  id: "platform1",
  position: [-1, 0.65, 0],
  scale: [1.5, 1, 1],
  behavior: { type: "bounce" },
};

function matrixAt(x: number, y: number, z: number) {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
}

function sample(index: number, y: number) {
  return {
    atPerformanceMs: index * 40,
    player: {
      center: [-1, y, 0],
      runtimeCenter: [-1, y, 0],
    },
    platforms: {
      platform1: {
        center: [-1, 0.69125, 0],
        runtimeMatrix: matrixAt(-1, 0.65, 0),
      },
    },
  };
}

describe("saved moving-bounce route evidence", () => {
  it("accepts contact followed by two upward observations across duplicate frames", () => {
    const contactY = 0.65 + asset.bounds.max[1] + 0.42;
    const samples = [
      sample(0, contactY + 0.12),
      sample(1, contactY),
      sample(2, contactY),
      sample(3, contactY + 0.05),
      sample(4, contactY + 0.12),
    ];
    const transition = bounceStageTransition(samples, entity, asset);
    expect(transition?.velocityDirectionReversal).toBe(true);
    expect(transition?.contactIndex).toBe(1);
    expect(transition?.ascentIndex).toBe(4);
  });

  it("rejects a continued fall and a flat surface hold", () => {
    const contactY = 0.65 + asset.bounds.max[1] + 0.42;
    const continuedFall = [
      sample(0, contactY + 0.12),
      sample(1, contactY),
      sample(2, contactY - 0.08),
      sample(3, contactY - 0.16),
    ];
    const flatHold = [
      sample(0, contactY + 0.12),
      sample(1, contactY),
      sample(2, contactY),
      sample(3, contactY),
      sample(4, contactY),
    ];
    expect(bounceStageTransition(continuedFall, entity, asset)).toBeNull();
    expect(bounceStageTransition(flatHold, entity, asset)).toBeNull();
  });

  it("keeps ground-reset and post-release jump evidence independent", () => {
    const samples = [
      sample(0, 0.42),
      sample(1, 1.2),
      sample(2, 1.35),
      sample(3, 0.48),
    ];
    expect(groundSamplesAfter(samples, 40)).toHaveLength(1);
    expect(
      jumpDownEventsAfter(
        [
          { key: " ", down: true, atPerformanceMs: 10 },
          { key: " ", down: false, atPerformanceMs: 50 },
          { type: "down", key: " ", atPerformanceMs: 70 },
        ],
        50,
      ),
    ).toHaveLength(1);
    const route = sequentialRouteAnalysis(
      [{ transition: { contactIndex: 2, velocityDirectionReversal: true } }],
      samples,
      {
        firstTakeoffAt: 40,
        expectedStageIds: ["platform1"],
        jumpEvents: [],
      },
    );
    expect(route.noGroundResetObserved).toBe(false);
    expect(route.finiteSampleInterval).toBe(true);
    expect(route.passed).toBe(false);
  });

  it("rejects falling through a contact and rising later elsewhere", () => {
    const contactY = 0.65 + asset.bounds.max[1] + 0.42;
    const samples = [
      sample(0, contactY + 0.12),
      sample(1, contactY),
      sample(2, contactY - 0.2),
      sample(3, contactY - 0.28),
      sample(4, contactY - 0.16),
      sample(5, contactY - 0.08),
    ];
    expect(bounceStageTransition(samples, entity, asset)).toBeNull();
  });

  it("requires all three named stages and release before each contact", () => {
    const stage = (id: string, contactAtPerformanceMs: number) => ({
      id,
      jumpInputReleasedAt: contactAtPerformanceMs + 1,
      transition: {
        contactIndex: contactAtPerformanceMs / 40,
        contactAtPerformanceMs,
        velocityDirectionReversal: true,
      },
    });
    const route = sequentialRouteAnalysis(
      [stage("platform1", 100), stage("platform2", 200)],
      [],
      { firstTakeoffAt: 0 },
    );
    expect(route.exactStageSet).toBe(false);
    expect(route.releaseBeforeContact).toBe(false);
    expect(route.passed).toBe(false);

    const emptyRoute = sequentialRouteAnalysis([], [], {
      expectedStageIds: [],
    });
    expect(emptyRoute.exactStageSet).toBe(false);
    expect(emptyRoute.finiteSampleInterval).toBe(false);
    expect(emptyRoute.passed).toBe(false);
  });

  it("bounds the no-ground interval at the final bounce ascent", () => {
    const route = sequentialRouteAnalysis(
      [
        {
          id: "platform1",
          jumpInputReleasedAt: 0,
          transition: {
            contactIndex: 1,
            contactAtPerformanceMs: 40,
            ascentAtPerformanceMs: 80,
            velocityDirectionReversal: true,
          },
        },
      ],
      [sample(0, 1.1), sample(1, 1.4), sample(2, 1.7), sample(3, 0.42)],
      {
        firstTakeoffAt: 0,
        groundObservationEndAt: 80,
        expectedStageIds: ["platform1"],
        jumpEvents: [],
      },
    );
    expect(route.noGroundResetObserved).toBe(true);
    expect(route.groundContactSamples).toHaveLength(0);
    expect(route.passed).toBe(true);
    expect(route.limitation).toContain("final bounce ascent");
    expect(route.groundObservationBoundCoversFinalAscent).toBe(true);
  });

  it.each([40, NaN, -Infinity])(
    "rejects invalid or premature no-ground bound %s",
    (groundObservationEndAt) => {
      const route = sequentialRouteAnalysis(
        [
          {
            id: "platform1",
            jumpInputReleasedAt: 0,
            transition: {
              contactIndex: 1,
              contactAtPerformanceMs: 40,
              ascentAtPerformanceMs: 80,
              velocityDirectionReversal: true,
            },
          },
        ],
        [sample(0, 1.1), sample(1, 1.4), sample(2, 1.7), sample(3, 0.42)],
        {
          firstTakeoffAt: 0,
          groundObservationEndAt,
          expectedStageIds: ["platform1"],
          jumpEvents: [],
        },
      );
      expect(route.noGroundResetObserved).toBe(true);
      expect(route.groundObservationBoundCoversFinalAscent).toBe(false);
      expect(route.passed).toBe(false);
    },
  );

  it.each([-0.686, 0.686])(
    "keeps steering when the player is just outside the strict footprint (%s)",
    (playerX) => {
      expect(
        platformFootprintSteeringNeeded({
          playerCenter: [playerX, 1, 0],
          target: [0, 1, 0],
          halfX: 0.67,
          halfZ: 0.4,
          margin: 0.01,
        }),
      ).toBe(true);
      expect(
        platformFootprintSteeringNeeded({
          playerCenter: [Math.sign(playerX) * 0.665, 1, 0],
          target: [0, 1, 0],
          halfX: 0.67,
          halfZ: 0.4,
          margin: 0.01,
        }),
      ).toBe(true);
      expect(
        platformFootprintSteeringNeeded({
          playerCenter: [Math.sign(playerX) * 0.65, 1, 0],
          target: [0, 1, 0],
          halfX: 0.67,
          halfZ: 0.4,
          margin: 0.01,
        }),
      ).toBe(false);
    },
  );
});
