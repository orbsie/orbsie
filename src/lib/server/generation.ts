import {
  assertModelingCommand,
  localModelingInstructions,
} from "../modeling-policy";
import { deriveAssetPolicy, enforceAssetPolicy } from "../asset-policy";
import { promptCatalogForPolicy } from "../asset-catalog";
import { authoringHistory } from "../authoring-history";
import {
  commandSchema,
  applyOperation,
  type Project,
  type Cursor,
} from "../protocol";
import { z } from "zod";
import { isRecommendedModel } from "../model-modes";
export class GenerationProviderError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
function providerFailure(status: number) {
  const failures: Record<number, [number, string]> = {
    400: [
      400,
      "The provider rejected this model or request. Check your model in Advanced.",
    ],
    401: [
      401,
      "The provider rejected your API key. Check your provider connection.",
    ],
    402: [
      402,
      "Your provider could not authorize payment. Check its credits and spending limits.",
    ],
    403: [
      403,
      "Your provider denied access to this model. Check the key permissions and provider settings.",
    ],
    404: [
      400,
      "This model is unavailable from your provider. Choose another model in Advanced.",
    ],
    429: [
      429,
      "Your provider is busy or rate limited. Wait a moment and retry.",
    ],
  };
  const [code, message] = failures[status] ?? [
    502,
    "Your provider is temporarily unavailable. Please try again shortly.",
  ];
  return new GenerationProviderError(code, message);
}
export const commandJSONSchema = z.toJSONSchema(commandSchema);
export const systemPrompt = `You create playful, coherent 3D worlds for Orbsie. Use recentConversation only as context for references and prior preferences; the current instruction and current project snapshot govern this turn. Output ONLY newline-delimited JSON, one complete command per line, without Markdown. Each line must match the provided command schema. Reserve only NEW entities FIRST with a new stable ID, label, position, scale, color, stage seed. For edits to an existing entity ID, use setters directly; NEVER reserve that ID again or remove/recreate it. Preserve the existing ID and all unrelated entities. Then send set_geometry coarse and refined as separate commands, except objects referenced by project.game must receive refined replacements directly so their saved gameplay remains valid. Use reusable kinds or custom parts to invent varied objects. Coordinates: x/z ground plane, y up; playable circular island radius 8, start at [0,0,5]. Keep all objects on island. Use max 70 objects, max 16 parts/object. Trees ~2 units tall. Supported behaviors: static, collect (crystal), move (platform, axis/speed/amplitude), portal (unlocks when all collect entities are collected), bloom (click), bounce. For composable games use set_game with the complete data-only program: variables, ordered rules, start/click/collision/collect/input/timer triggers, conditions, and actions including score, win/lose/reset and movement paths. Finish referenced entities to ready before set_game. Replace or clear rules with set_game before removing a referenced object. game:null removes the program. Keep unrelated rules when editing; use the current project.game as the baseline. A game program owns score and outcomes; define them explicitly instead of relying on the legacy portal auto-win. Never include code, URLs, credentials, scripts, or external assets. You may use known local catalog IDs supplied in assetCatalog via kind asset and assetId. Prefer a useful mix of catalog models and newly generated procedural/custom shapes, alternating where they fit the request; never force an unsuitable substitution. Explicit new-only policy prohibits catalog reuse for that scope, including follow-up edits. Preserve original catalog material colors unless recoloring is requested; use set_material for an explicit tint. For object edits, preserve all unrelated entities. Conclude with commit_revision with a brief friendly message. ${localModelingInstructions} You may only use commands matching this schema: ${JSON.stringify(commandJSONSchema)}`;
export async function generateCommands({
  provider,
  model,
  key,
  prompt,
  project,
  selected,
  signal,
  maxTokens = 10000,
  localModeling = false,
}: {
  provider: "openrouter" | "gateway";
  model: string;
  key: string;
  prompt: string;
  project: Project;
  selected?: string;
  signal: AbortSignal;
  maxTokens?: number;
  localModeling?: boolean;
}) {
  const assetPolicy = deriveAssetPolicy(prompt, selected, project);
  const endpoint =
    provider === "openrouter"
      ? "https://openrouter.ai/api/v1/chat/completions"
      : "https://ai-gateway.vercel.sh/v1/chat/completions";
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(provider === "openrouter"
        ? { "HTTP-Referer": "https://orbsie.com", "X-Title": "Orbsie" }
        : {}),
    },
    body: JSON.stringify({
      model,
      stream: true,
      max_tokens: maxTokens,
      ...(isRecommendedModel(model) ? { reasoning: { effort: "low" } } : {}),
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: JSON.stringify({
            instruction: prompt,
            recentConversation: authoringHistory(project, prompt),
            localModeling,
            assetPolicy,
            assetCatalog: promptCatalogForPolicy(
              assetPolicy.requestAssetPolicy,
            ),
            selectedEntityId: selected,
            project: { ...project, messages: [] },
          }),
        },
      ],
    }),
    signal,
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw providerFailure(response.status);
  }
  return new ReadableStream({
    async start(controller) {
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      const encoder = new TextEncoder();
      let buffer = "",
        records = "",
        working = project,
        count = 0,
        lastCommandType = "";
      let cursor: Cursor = {
        runId: crypto.randomUUID(),
        sequence: 0,
        seen: new Set(),
      };
      function emit(line: string) {
        if (!line.trim()) return;
        if (++count > 250)
          throw Error(
            "This turn reached its scene update limit. Continue from the saved world.",
          );
        const command = enforceAssetPolicy(
          working,
          commandSchema.parse(JSON.parse(line)),
          assetPolicy,
        );
        assertModelingCommand(command, localModeling);
        const applied = applyOperation(
          working,
          {
            version: 1,
            projectId: working.id,
            runId: cursor.runId,
            operationId: crypto.randomUUID(),
            sequence: cursor.sequence + 1,
            baseRevision: working.revision,
            command,
          },
          cursor,
        );
        working = applied.project;
        cursor = applied.cursor;
        lastCommandType = command.type;
        controller.enqueue(encoder.encode(JSON.stringify(command) + "\n"));
      }
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          if (buffer.length > 200000)
            throw Error("Provider event exceeded the size limit.");
          const lines = buffer.split("\n");
          buffer = lines.pop()!;
          for (const line of lines) {
            if (!line.startsWith("data:")) continue;
            const text = line.slice(5).trim();
            if (!text || text === "[DONE]") continue;
            const event = JSON.parse(text);
            if (event.error)
              throw Error(
                "The provider interrupted this generation. Please retry.",
              );
            const delta = event.choices?.[0]?.delta?.content;
            if (typeof delta !== "string") continue;
            records += delta;
            if (records.length > 100000)
              throw Error("Scene command exceeded the size limit.");
            const complete = records.split("\n");
            records = complete.pop()!;
            for (const record of complete) emit(record);
          }
        }
        if (records.trim()) emit(records);
        if (!count)
          throw Error(
            "This model did not return any supported scene commands. Select another model.",
          );
        if (lastCommandType !== "commit_revision")
          throw Error(
            "Generation ended before committing this turn. Finished objects are preserved; retry to continue.",
          );
      } catch (error) {
        controller.enqueue(
          encoder.encode(
            JSON.stringify({
              error:
                error instanceof Error &&
                !(error instanceof z.ZodError) &&
                !(error instanceof SyntaxError)
                  ? error.message
                  : "The model returned an invalid scene update. Finished objects are preserved.",
            }) + "\n",
          ),
        );
      } finally {
        await reader.cancel().catch(() => {});
        controller.close();
      }
    },
  });
}
