const DEFAULT_EXPECTED_COLLECTIBLE_COUNT = 5;
const DEFAULT_PORTAL_COMPARISON = "eq";
const PORTAL_COMPARISONS = new Set(["eq", "gte"]);

/**
 * Validate the flagship collectible/portal program before traversal.
 *
 * The default contract remains the original five-crystal/equality game. The
 * saved Gateway checkpoint uses the same program shape with seven crystals
 * and a greater-than-or-equal portal gate, so callers must opt into that
 * contract explicitly.
 */
export function validateProjectGame(project, options = {}) {
  const expectedCollectibleCount =
    options.expectedCollectibleCount ??
    options.expectedCount ??
    DEFAULT_EXPECTED_COLLECTIBLE_COUNT;
  const portalComparison =
    options.portalComparison ?? options.comparison ?? DEFAULT_PORTAL_COMPARISON;
  if (
    !Number.isSafeInteger(expectedCollectibleCount) ||
    expectedCollectibleCount < 1
  )
    throw Error(
      "Flagship traversal expected collectible count must be a positive integer.",
    );
  if (!PORTAL_COMPARISONS.has(portalComparison))
    throw Error(
      `Flagship traversal portal comparison must be one of ${[
        ...PORTAL_COMPARISONS,
      ].join(", ")}.`,
    );
  const expectedCountLabel =
    expectedCollectibleCount === 5 ? "five" : String(expectedCollectibleCount);
  const portalComparisonLabel = portalComparison === "eq" ? "==" : ">=";
  if (!project?.game || !Array.isArray(project.game.rules))
    throw Error("Flagship snapshot must contain a project.game program.");
  const collectibles = Array.isArray(project.entities)
    ? project.entities.filter((entity) => entity.behavior?.type === "collect")
    : [];
  const collectibleIds = collectibles.map((entity) => entity.id);
  if (
    collectibleIds.length !== expectedCollectibleCount ||
    new Set(collectibleIds).size !== expectedCollectibleCount
  )
    throw Error(
      `Flagship snapshot must contain ${expectedCountLabel} unique collect entities; got ${collectibleIds.join(", ")}.`,
    );
  const collectRuleIds = project.game.rules
    .filter((rule) => rule.trigger?.type === "collect")
    .map((rule) => rule.trigger.entityId);
  if (
    collectRuleIds.length !== expectedCollectibleCount ||
    new Set(collectRuleIds).size !== expectedCollectibleCount ||
    collectibleIds.some((id) => !collectRuleIds.includes(id))
  )
    throw Error(
      `Flagship game must collect each crystal exactly once; got ${collectRuleIds.join(", ")}.`,
    );
  const portals = project.entities.filter(
    (entity) => entity.behavior?.type === "portal",
  );
  if (portals.length === 0)
    throw Error("Flagship snapshot must contain a portal entity.");
  if (portals.length !== 1)
    throw Error(
      `Flagship snapshot must contain exactly one portal entity; got ${portals
        .map((portal) => portal.id)
        .join(", ")}.`,
    );
  const portal = portals[0];
  const winningRules = project.game.rules.filter((rule) =>
    rule.actions?.some((action) => action?.type === "win"),
  );
  if (winningRules.length === 0)
    throw Error(`Flagship game must win on portal collision (${portal.id}).`);
  if (winningRules.length !== 1)
    throw Error(
      `Flagship game must have exactly one winning path on portal collision (${portal.id}); got ${winningRules.length}.`,
    );
  const [portalWin] = winningRules;
  if (
    portalWin.trigger?.type !== "collision" ||
    portalWin.trigger.entityId !== portal.id
  )
    throw Error(
      `Flagship game must win only on portal collision (${portal.id}); found a contradictory win path.`,
    );
  const crystalConditions = (portalWin.conditions ?? []).filter(
    (condition) =>
      condition?.operand?.type === "variable" &&
      condition.operand.name === "crystals",
  );
  const portalGate = crystalConditions.filter(
    (condition) =>
      condition.comparison === portalComparison &&
      condition.value === expectedCollectibleCount,
  );
  if (crystalConditions.length !== 1 || portalGate.length !== 1)
    throw Error(
      `Flagship portal win rule must be gated by crystals ${portalComparisonLabel} ${expectedCollectibleCount}.`,
    );
  return {
    collectibleIds,
    collectRuleIds,
    portalId: portal.id,
    ruleCount: project.game.rules.length,
  };
}
