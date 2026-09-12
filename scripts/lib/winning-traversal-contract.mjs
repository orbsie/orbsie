/** Validate the flagship collectible/portal program before traversal. */
export function validateProjectGame(project) {
  if (!project?.game || !Array.isArray(project.game.rules))
    throw Error("Flagship snapshot must contain a project.game program.");
  const collectibles = Array.isArray(project.entities)
    ? project.entities.filter((entity) => entity.behavior?.type === "collect")
    : [];
  const collectibleIds = collectibles.map((entity) => entity.id);
  if (collectibleIds.length !== 5 || new Set(collectibleIds).size !== 5)
    throw Error(
      `Flagship snapshot must contain five unique collect entities; got ${collectibleIds.join(", ")}.`,
    );
  const collectRuleIds = project.game.rules
    .filter((rule) => rule.trigger?.type === "collect")
    .map((rule) => rule.trigger.entityId);
  if (
    collectRuleIds.length !== 5 ||
    new Set(collectRuleIds).size !== 5 ||
    collectibleIds.some((id) => !collectRuleIds.includes(id))
  )
    throw Error(
      `Flagship game must collect each crystal exactly once; got ${collectRuleIds.join(", ")}.`,
    );
  const portal = project.entities.find(
    (entity) => entity.behavior?.type === "portal",
  );
  if (!portal) throw Error("Flagship snapshot must contain a portal entity.");
  const portalWin = project.game.rules.find(
    (rule) =>
      rule.trigger?.type === "collision" &&
      rule.trigger.entityId === portal.id &&
      rule.actions?.some((action) => action.type === "win"),
  );
  if (!portalWin)
    throw Error(`Flagship game must win on portal collision (${portal.id}).`);
  const portalGate = portalWin.conditions?.some(
    (condition) =>
      condition.operand?.type === "variable" &&
      condition.operand.name === "crystals" &&
      condition.comparison === "eq" &&
      condition.value === 5,
  );
  if (!portalGate)
    throw Error("Flagship portal win rule must be gated by crystals == 5.");
  return {
    collectibleIds,
    collectRuleIds,
    portalId: portal.id,
    ruleCount: project.game.rules.length,
  };
}
