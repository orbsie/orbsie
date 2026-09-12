import type { Project } from "./protocol";

const MOVEMENT_HELP = "W A S D / Arrow keys to move · Space to jump";

/**
 * Describe only interactions the standalone runtime actually enables.
 *
 * Keyboard movement and jumping are always available to the avatar. Legacy
 * bloom clicks are available only when there is no data game program; once a
 * program exists, clicks are routed to its declared click triggers instead.
 */
export function playerControlsHelp(
  project: Pick<Project, "entities" | "game">,
  touch = false,
) {
  const movement = touch
    ? "Use the controls below to move and jump"
    : MOVEMENT_HELP;
  const interaction = touch ? "Tap" : "Click";
  if (project.game) {
    return project.game.rules.some((rule) => rule.trigger.type === "click")
      ? `${movement} · ${interaction} objects to interact`
      : movement;
  }

  return project.entities.some((entity) => entity.behavior?.type === "bloom")
    ? `${movement} · ${interaction} flowers to bloom`
    : movement;
}
