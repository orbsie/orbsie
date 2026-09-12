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
  if (!Array.isArray(project.game.variables))
    throw Error(
      "Flagship game must declare a crystals variable initialized to 0.",
    );
  const crystalVariables = project.game.variables.filter(
    (variable) => variable?.name === "crystals",
  );
  if (crystalVariables.length !== 1 || crystalVariables[0]?.initial !== 0)
    throw Error(
      "Flagship game must declare exactly one crystals variable initialized to 0.",
    );
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
  const collectRules = project.game.rules.filter(
    (rule) => rule.trigger?.type === "collect",
  );
  const collectRuleIds = collectRules.map((rule) => rule.trigger.entityId);
  if (
    collectRuleIds.length !== expectedCollectibleCount ||
    new Set(collectRuleIds).size !== expectedCollectibleCount ||
    collectibleIds.some((id) => !collectRuleIds.includes(id))
  )
    throw Error(
      `Flagship game must collect each crystal exactly once; got ${collectRuleIds.join(", ")}.`,
    );
  const collectRuleSet = new Set(collectRules);
  const scoreAmounts = [];
  for (const rule of project.game.rules) {
    const actions = Array.isArray(rule.actions) ? rule.actions : [];
    // A reset can erase accumulated score/counter state before portal contact.
    if (actions.some((action) => action?.type === "reset"))
      throw Error(
        `Flagship game cannot use reset actions in rule ${rule.id ?? "unknown"}.`,
      );
    const scoreWriters = actions.filter(
      (action) => action?.type === "add_score",
    );
    const crystalWriters = actions.filter(
      (action) =>
        (action?.type === "set_variable" || action?.type === "add_variable") &&
        action.name === "crystals",
    );
    if (!collectRuleSet.has(rule)) {
      if (scoreWriters.length > 0)
        throw Error(
          `Flagship game contains an unrelated score writer in rule ${rule.id ?? "unknown"}.`,
        );
      if (crystalWriters.length > 0)
        throw Error(
          `Flagship game contains an unrelated crystals writer in rule ${rule.id ?? "unknown"}.`,
        );
      continue;
    }
    if (rule.conditions !== undefined && !Array.isArray(rule.conditions))
      throw Error(
        `Flagship collect rule ${rule.id ?? "unknown"} must be unconditional.`,
      );
    if ((rule.conditions ?? []).length !== 0)
      throw Error(
        `Flagship collect rule ${rule.id ?? "unknown"} must be unconditional.`,
      );
    if (
      crystalWriters.length !== 1 ||
      crystalWriters[0].type !== "add_variable" ||
      crystalWriters[0].amount !== 1
    )
      throw Error(
        `Flagship collect rule ${rule.id ?? "unknown"} must increment crystals by exactly 1.`,
      );
    if (scoreWriters.length !== 1) {
      throw Error(
        `Flagship collect rule ${rule.id ?? "unknown"} must add exactly one score amount.`,
      );
    }
    const scoreAmount = scoreWriters[0].amount;
    // The traversal HUD exposes whole-number scores, so decimals are outside
    // this verifier contract even though the product schema accepts numbers.
    if (
      typeof scoreAmount !== "number" ||
      !Number.isSafeInteger(scoreAmount) ||
      scoreAmount <= 0
    )
      throw Error(
        `Flagship collect rule ${rule.id ?? "unknown"} must add a finite positive integer score amount.`,
      );
    scoreAmounts.push(scoreAmount);
  }
  const scorePerCollect = scoreAmounts[0];
  if (scoreAmounts.some((amount) => amount !== scorePerCollect))
    throw Error(
      `Flagship collect rules must use one consistent score amount per crystal; got ${scoreAmounts.join(", ")}.`,
    );
  const expectedScore = scoreAmounts.reduce(
    (total, amount) => total + amount,
    0,
  );
  if (!Number.isSafeInteger(expectedScore))
    throw Error("Flagship game expected score must be a finite safe integer.");
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
    expectedScore,
    scorePerCollect,
    ruleCount: project.game.rules.length,
  };
}
