// Read-only acceptance calculations for the saved moving-bounce route.
// Gameplay contact stays bound to the source catalog proxy and the runtime
// Formation matrix. This module contains no renderer, store, or input code.
import { sourceLandingEvidence } from "./flagship-platforms-verifier.mjs";

export const BOUNCE_ASCENT_DELTA = 0.015;
export const BOUNCE_ASCENT_RISE = 0.08;
export const BOUNCE_CONTACT_SETTLE_DELTA = 0.012;
export const BOUNCE_CONTACT_MAX_DEPTH = 0.18;
export const GROUND_CENTER_Y = 0.5;
export const PLATFORM_INTERCEPT_MARGIN = 0.01;

export function runtimePlayerCenter(sample) {
  return sample?.player?.runtimeCenter ?? sample?.player?.center ?? null;
}

function sampleTime(sample) {
  return sample?.atPerformanceMs;
}

function finiteVec3(value) {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((component) => Number.isFinite(component))
  );
}

/**
 * Keep the player inside an inward margin of the strict source footprint.
 * @param {{playerCenter?: number[], target?: number[], halfX?: number, halfZ?: number, margin?: number}} options
 */
export function platformFootprintSteeringNeeded({
  playerCenter,
  target,
  halfX,
  halfZ,
  margin = PLATFORM_INTERCEPT_MARGIN,
} = {}) {
  if (
    !finiteVec3(playerCenter) ||
    !finiteVec3(target) ||
    ![halfX, halfZ, margin].every(Number.isFinite) ||
    halfX < 0 ||
    halfZ < 0 ||
    margin < 0
  )
    return true;
  return (
    Math.abs(playerCenter[0] - target[0]) > Math.max(0, halfX - margin) ||
    Math.abs(playerCenter[2] - target[2]) > Math.max(0, halfZ - margin)
  );
}

/**
 * Find a real source contact followed by a measured bounce launch.
 *
 * A rendered frame may repeat while the browser compositor is catching up.
 * Repeated frames are allowed around the contact minimum, but launch proof
 * requires two later samples at distinct indices with positive Y movement and
 * a minimum total rise. A pass-through fall or a flat frame at the surface
 * therefore cannot satisfy this contract.
 */
export function bounceStageTransition(
  samples,
  entity,
  asset,
  { startAt = -Infinity, candidateStart = 1 } = {},
) {
  if (!Array.isArray(samples) || !entity || !asset) return null;
  for (
    let index = Math.max(1, candidateStart);
    index < samples.length;
    index++
  ) {
    const previous = samples[index - 1];
    const current = samples[index];
    if (sampleTime(current) < startAt) continue;
    const evidence = sourceLandingEvidence(previous, current, entity, asset);
    if (!evidence.accepted) continue;

    let minimumIndex = index;
    let minimumY = runtimePlayerCenter(current)?.[1];
    if (!Number.isFinite(minimumY)) continue;
    const contactY = evidence.source?.contactY;
    if (!Number.isFinite(contactY)) continue;
    // Include a short contact hold in the measured minimum. This handles a
    // repeated rendered frame without treating a later fall as a launch.
    let departedAfterContact = false;
    for (
      let next = index + 1;
      next < Math.min(samples.length, index + 7);
      next++
    ) {
      const previousY = runtimePlayerCenter(samples[next - 1])?.[1];
      const currentY = runtimePlayerCenter(samples[next])?.[1];
      if (!Number.isFinite(previousY) || !Number.isFinite(currentY)) break;
      if (
        currentY < contactY - BOUNCE_CONTACT_MAX_DEPTH ||
        currentY < previousY - BOUNCE_CONTACT_SETTLE_DELTA
      ) {
        departedAfterContact = true;
        break;
      }
      if (Math.abs(currentY - previousY) <= BOUNCE_CONTACT_SETTLE_DELTA) {
        minimumIndex = next;
        minimumY = Math.min(minimumY, currentY);
      } else break;
    }
    if (departedAfterContact) continue;

    let upwardSteps = 0;
    const ascentDeltas = [];
    for (
      let next = minimumIndex + 1;
      next < Math.min(samples.length, minimumIndex + 14);
      next++
    ) {
      const previousSample = samples[next - 1];
      const currentSample = samples[next];
      const previousY = runtimePlayerCenter(previousSample)?.[1];
      const currentY = runtimePlayerCenter(currentSample)?.[1];
      const previousTime = sampleTime(previousSample);
      const currentTime = sampleTime(currentSample);
      if (
        !Number.isFinite(previousY) ||
        !Number.isFinite(currentY) ||
        !Number.isFinite(previousTime) ||
        !Number.isFinite(currentTime) ||
        currentTime <= previousTime
      ) {
        upwardSteps = 0;
        ascentDeltas.length = 0;
        continue;
      }
      const delta = currentY - previousY;
      if (delta >= BOUNCE_ASCENT_DELTA) {
        upwardSteps += 1;
        ascentDeltas.push(delta);
        if (upwardSteps >= 2 && currentY - minimumY >= BOUNCE_ASCENT_RISE)
          return {
            contactIndex: index,
            minimumIndex,
            ascentIndex: next,
            contact: evidence,
            contactAtPerformanceMs: sampleTime(current),
            ascentAtPerformanceMs: currentTime,
            ascentDeltas: ascentDeltas.slice(-2),
            minimumY,
            ascentRise: currentY - minimumY,
            velocityDirectionReversal:
              evidence.descending &&
              ascentDeltas.slice(-2).every((value) => value > 0),
          };
      } else if (delta !== 0) {
        // Preserve ascent across exact duplicate frames, while requiring a
        // fresh two-sample rise after any measured reversal or flat drift.
        upwardSteps = 0;
        ascentDeltas.length = 0;
      }
    }
  }
  return null;
}

export function groundSamplesAfter(
  samples,
  atPerformanceMs,
  threshold = GROUND_CENTER_Y,
) {
  return (samples ?? []).filter((sample) => {
    const at = sampleTime(sample);
    const y = runtimePlayerCenter(sample)?.[1];
    return (
      Number.isFinite(at) &&
      at >= atPerformanceMs &&
      Number.isFinite(y) &&
      y <= threshold
    );
  });
}

export function jumpDownEventsAfter(events, atPerformanceMs) {
  return (events ?? []).filter((event) => {
    const key = String(event?.key ?? "").toLowerCase();
    const isDown = event?.down === true || event?.type === "down";
    return (
      isDown &&
      Number.isFinite(event?.atPerformanceMs) &&
      event.atPerformanceMs >= atPerformanceMs &&
      (key === " " || key === "spacebar" || key === "jump")
    );
  });
}

export function sequentialRouteAnalysis(
  stages,
  samples,
  {
    firstTakeoffAt = -Infinity,
    groundObservationEndAt = Infinity,
    groundThreshold = GROUND_CENTER_Y,
    expectedStageIds = ["platform1", "platform2", "platform3"],
    jumpEvents = [],
  } = {},
) {
  const routeStages = stages ?? [];
  const contacts = routeStages
    .map((stage) => stage?.transition)
    .filter(Boolean);
  const stageIds = routeStages.map((stage) => stage?.id);
  const finalAscentAt = contacts.at(-1)?.ascentAtPerformanceMs;
  const groundObservationBoundCoversFinalAscent =
    Number.isFinite(finalAscentAt) &&
    (groundObservationEndAt === Infinity ||
      (Number.isFinite(groundObservationEndAt) &&
        groundObservationEndAt >= finalAscentAt));
  const ground = groundSamplesAfter(
    samples,
    firstTakeoffAt,
    groundThreshold,
  ).filter((sample) => sampleTime(sample) <= groundObservationEndAt);
  const expectedIds = [...expectedStageIds];
  const finiteSampleTimes = (samples ?? [])
    .map((sample) => sampleTime(sample))
    .filter(Number.isFinite);
  const finiteSampleInterval = finiteSampleTimes.some(
    (time, index) => index > 0 && time > finiteSampleTimes[index - 1],
  );
  const exactStageSet =
    expectedIds.length > 0 &&
    stageIds.length === expectedIds.length &&
    new Set(stageIds).size === expectedIds.length &&
    expectedIds.every((id, index) => stageIds[index] === id);
  const ordered = contacts.every((contact, index) =>
    index === 0 && Number.isFinite(contact.contactAtPerformanceMs)
      ? true
      : Number.isFinite(contact.contactAtPerformanceMs) &&
        contact.contactAtPerformanceMs >
          contacts[index - 1].contactAtPerformanceMs,
  );
  const releaseBeforeContact = routeStages.every(
    (stage) =>
      Number.isFinite(stage?.jumpInputReleasedAt) &&
      Number.isFinite(stage?.transition?.contactAtPerformanceMs) &&
      stage.jumpInputReleasedAt <= stage.transition.contactAtPerformanceMs,
  );
  const postReleaseJumpEvents = jumpDownEventsAfter(jumpEvents, firstTakeoffAt);
  return {
    stageCount: routeStages.length,
    stageIds,
    expectedStageIds: expectedIds,
    exactStageSet,
    finiteSampleInterval,
    contactCount: contacts.length,
    ordered,
    releaseBeforeContact,
    postReleaseJumpEvents,
    transitions: contacts,
    groundContactSamples: ground,
    noGroundResetObserved: ground.length === 0,
    groundObservationBoundCoversFinalAscent,
    limitation: Number.isFinite(groundObservationEndAt)
      ? "Sampled telemetry cannot prove absence of ground contact between rendered frames; the bounded no-ground interval ends at the final bounce ascent."
      : "Sampled telemetry cannot prove absence of ground contact between rendered frames.",
    passed:
      exactStageSet &&
      contacts.length === expectedIds.length &&
      ordered &&
      releaseBeforeContact &&
      postReleaseJumpEvents.length === 0 &&
      finiteSampleInterval &&
      groundObservationBoundCoversFinalAscent &&
      contacts.every((contact) => contact.velocityDirectionReversal) &&
      ground.length === 0,
  };
}
