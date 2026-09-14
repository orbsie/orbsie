/** Derive journey completeness from observed phases; never infer omitted checks. */
export function flagshipJourneyAcceptance(report) {
  const missing = [];
  const requireEvidence = (condition, reason) => {
    if (!condition) missing.push(reason);
  };
  const revision = (value) => Number.isSafeInteger(value) && value >= 0;
  const bound = (value, projectId, expectedRevision) =>
    value?.projectId === projectId &&
    value?.revision === expectedRevision &&
    typeof projectId === "string" &&
    projectId.length > 0 &&
    revision(expectedRevision);
  const story = report?.flagshipStory;
  const phases = story?.phases;
  const created = phases?.creation;
  const projectId = created?.gameplay?.projectId;
  const createdRevision = created?.revision;
  const undoRevision = story?.undo?.restoredRevision;
  requireEvidence(
    report?.mode === "live-browser" &&
      Number.isSafeInteger(report?.traffic?.generationRequests) &&
      report.traffic.generationRequests >= 3 &&
      report?.traffic?.interceptedGeneration === false &&
      !report?.syntheticInference &&
      !report?.fallbackUsed &&
      !report?.error &&
      !report?.flagshipResume &&
      !report?.traffic?.generationBudgetViolations?.length,
    "fresh-live-generation",
  );
  requireEvidence(
    story?.status === "passed" && !story?.limitations?.length,
    "complete-story-scope",
  );
  requireEvidence(
    report?.creation?.status === "passed" &&
      report?.creation?.seedObserved === true &&
      created?.status !== "seeded",
    "fresh-visible-creation",
  );
  const during = report?.creation?.gameplayDuringGeneration;
  requireEvidence(
    during?.status === "passed" &&
      during?.projectId === projectId &&
      during?.generationStreamOpenAtMovement === true &&
      during?.generationStreamOpenAfterMovement === true &&
      Number.isFinite(during?.movementDistance) &&
      during.movementDistance >= 0.12 &&
      revision(during?.revisionBefore) &&
      revision(during?.revisionAfter) &&
      during.revisionBefore <= during.revisionAfter &&
      during.revisionAfter <= createdRevision,
    "movement-during-generation",
  );

  function gameplay(value, expectedRevision, count, label) {
    const expected = value?.expectedCollectibleIds;
    const collected = value?.collectedIds;
    const idsMatch =
      Array.isArray(expected) &&
      expected.length === count &&
      new Set(expected).size === count &&
      expected.every((id) => typeof id === "string" && id.length > 0) &&
      Array.isArray(collected) &&
      collected.length === count &&
      new Set(collected).size === count &&
      expected.every((id) => collected.includes(id));
    const platforms = value?.platformEvidence;
    const contacted =
      Array.isArray(platforms) &&
      platforms.length >= 3 &&
      new Set(platforms.map((p) => p?.id)).size === platforms.length &&
      platforms.every(
        (p) =>
          typeof p?.id === "string" &&
          p.id.length > 0 &&
          Number.isSafeInteger(p.groundedFrames) &&
          Number.isSafeInteger(p.bounceFrames) &&
          (p.groundedFrames > 0 || p.bounceFrames > 0) &&
          Number.isFinite(p.maximumDisplacement) &&
          p.maximumDisplacement >= 0.05 &&
          (p.behavior !== "bounce" || p.bounceFrames > 0),
      ) &&
      platforms.some((p) => p.behavior === "bounce" && p.bounceFrames > 0);
    requireEvidence(
      bound(value, projectId, expectedRevision) &&
        idsMatch &&
        value?.won === true &&
        value?.score === count &&
        bound(value?.win, projectId, expectedRevision) &&
        value.win.status === "won" &&
        value.win.score === count &&
        typeof value.win.portalId === "string" &&
        value.win.portalId.length > 0 &&
        Array.isArray(value?.contacts) &&
        value.contacts.includes(value.win.portalId) &&
        contacted &&
        bound(value?.reset, projectId, expectedRevision) &&
        Array.isArray(value.reset.scoreIds) &&
        value.reset.scoreIds.length === 0 &&
        value.reset.status === "playing" &&
        value.reset.score === 0 &&
        value.reset.lifecycleAdvanced === true &&
        Array.isArray(value.reset.player?.position) &&
        value.reset.player.position.length === 3 &&
        value.reset.player.position.every(Number.isFinite) &&
        Math.hypot(
          value.reset.player.position[0],
          value.reset.player.position[2] - 5,
        ) <= 0.2,
      label,
    );
  }
  gameplay(created?.gameplay, createdRevision, 5, "creation-win-reset");
  const mushroom = phases?.mushroom;
  const seven = phases?.goal7;
  requireEvidence(
    mushroom?.status === "passed" &&
      revision(mushroom?.revision) &&
      mushroom.revision > createdRevision &&
      report?.edit?.selectedIdPreserved === true,
    "scoped-mushroom-edit",
  );
  requireEvidence(
    seven?.status === "passed" &&
      revision(seven?.revision) &&
      seven.revision > mushroom?.revision &&
      seven?.objective?.collectibleCount === 7 &&
      seven?.objective?.portalThreshold === 7,
    "seven-collectible-edit",
  );
  gameplay(seven?.gameplay, seven?.revision, 7, "seven-win-reset");
  requireEvidence(
    revision(undoRevision) &&
      undoRevision > seven?.revision &&
      story?.undo?.restoredMushroomState === true &&
      story?.undo?.objective?.collectibleCount === 5 &&
      story?.undo?.objective?.portalThreshold === 5,
    "original-undo",
  );
  gameplay(phases?.undo?.gameplay, undoRevision, 5, "undo-win-reset");
  requireEvidence(
    bound(report?.followOn, projectId, undoRevision) &&
      report?.localRecovery === "passed" &&
      report?.export === "passed",
    "same-project-refresh-export",
  );
  gameplay(report?.standaloneGameplay, undoRevision, 5, "standalone-win-reset");
  const publication = report?.publication;
  requireEvidence(
    publication?.mode === "real" &&
      publication?.status === "READY" &&
      bound(publication, projectId, undoRevision) &&
      publication?.signedOut === true &&
      publication?.editorProviderRequests === 0,
    "signed-out-publication",
  );
  const artifacts = publication?.artifactEvidence;
  const files = [
    "runtime.js",
    "runtime.css",
    "generated-geometry-worker.js",
    "asset-geometry-worker.js",
  ];
  requireEvidence(
    bound(artifacts?.manifest, projectId, undoRevision) &&
      files.every((file) => {
        const record = artifacts?.files?.[file];
        return (
          Number.isSafeInteger(record?.expected?.bytes) &&
          record.expected.bytes > 0 &&
          /^[a-f0-9]{64}$/.test(record?.expected?.sha256 ?? "") &&
          [record?.target, record?.observed].every(
            (value) =>
              value?.bytes === record.expected.bytes &&
              value?.sha256 === record.expected.sha256,
          )
        );
      }),
    "current-publication-artifacts",
  );
  gameplay(publication?.gameplay, undoRevision, 5, "published-win-restart");
  return {
    version: 1,
    status: missing.length ? "incomplete" : "complete",
    missing,
    scope:
      "Flagship gameplay journey only; provider authentication, visual quality and physical-device acceptance are separate.",
  };
}
