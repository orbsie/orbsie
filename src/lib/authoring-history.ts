import type { Project } from "./protocol";

/** Recent dialogue is context data, never a new system instruction. */
export function authoringHistory(project: Project, currentPrompt: string) {
  const messages = project.messages;
  let end = messages.length;
  if (
    messages[end - 1]?.role === "user" &&
    messages[end - 1].text === currentPrompt
  )
    end--;
  const result: Project["messages"] = [];
  let remaining = 8000;
  for (let index = end - 1; index >= 0 && result.length < 8; index--) {
    const message = messages[index];
    // Keep whole messages and a contiguous suffix; never trim off a constraint.
    if (message.text.length > remaining) break;
    remaining -= message.text.length;
    result.unshift({
      role: message.role,
      text: message.text,
      ...(message.entityId &&
      project.entities.some((entity) => entity.id === message.entityId)
        ? { entityId: message.entityId }
        : {}),
    });
  }
  return result;
}
