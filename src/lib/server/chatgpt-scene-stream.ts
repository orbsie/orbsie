import { z } from "zod";
import {
  projectSchema,
  entitySchema,
  commandSchema,
  applyOperation,
  type Cursor,
  type Command,
} from "../protocol";
import { deriveAssetPolicy, enforceAssetPolicy } from "../asset-policy";
import { promptCatalogForPolicy } from "../asset-catalog";
import { authoringHistory } from "../authoring-history";
import { assertModelingCommand } from "../modeling-policy";
import { systemPromptForCapabilities } from "./generation";
import type { createChatGPTGeneration } from "./chatgpt-generation";

export const chatGPTSceneRequestSchema = z
  .object({
    model: z.string().min(1).max(256),
    effort: z.string().min(1).max(32),
    prompt: z.string().trim().min(1).max(4000),
    project: projectSchema,
    selected: entitySchema.shape.id.optional(),
    browserModeling: z.boolean().default(false),
    localModeling: z.literal(false).default(false),
  })
  .strict();

/** Only validated incremental commands cross into the live browser scene. */
export function createChatGPTSceneStream(
  raw: unknown,
  generator: ReturnType<typeof createChatGPTGeneration>,
  signal?: AbortSignal,
) {
  const input = chatGPTSceneRequestSchema.parse(raw);
  if (
    new Set(input.project.entities.map((e) => e.id)).size !==
      input.project.entities.length ||
    (input.selected &&
      !input.project.entities.some((e) => e.id === input.selected))
  )
    throw Error("Invalid selected world.");
  const policy = deriveAssetPolicy(input.prompt, input.selected, input.project);
  const modelInput = JSON.stringify({
    instruction: input.prompt,
    recentConversation: authoringHistory(input.project, input.prompt),
    localModeling: false,
    browserModeling: input.browserModeling,
    assetPolicy: policy,
    assetCatalog: promptCatalogForPolicy(policy.requestAssetPolicy),
    selectedEntityId: input.selected,
    project: { ...input.project, messages: [] },
  });
  if (Buffer.byteLength(modelInput) > 256 * 1024)
    throw Error("This world exceeds the ChatGPT request limit.");
  const local = new AbortController();
  const combined = signal
    ? AbortSignal.any([signal, local.signal])
    : local.signal;
  const encoder = new TextEncoder();
  let cancelled = false;
  return new ReadableStream<Uint8Array>(
    {
      async start(controller) {
        let working = input.project,
          buffer = "",
          count = 0,
          pendingCommit: Command | undefined;
        let cursor: Cursor = {
          runId: crypto.randomUUID(),
          sequence: 0,
          seen: new Set(),
        };
        const enqueue = (value: unknown) => {
          combined.throwIfAborted();
          if ((controller.desiredSize ?? 0) < -512 * 1024)
            throw Error("Client is too slow.");
          controller.enqueue(encoder.encode(JSON.stringify(value) + "\n"));
        };
        const emit = (line: string) => {
          if (!line.trim()) return;
          if (++count > 250) throw Error("Too many scene commands.");
          const command = enforceAssetPolicy(
            working,
            commandSchema.parse(JSON.parse(line)),
            policy,
          );
          assertModelingCommand(command, false, input.browserModeling);
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
          if (pendingCommit) enqueue(pendingCommit);
          pendingCommit =
            command.type === "commit_revision" ? command : undefined;
          if (!pendingCommit) enqueue(command);
        };
        try {
          await generator.generate({
            model: input.model,
            effort: input.effort,
            instructions: systemPromptForCapabilities(
              false,
              input.browserModeling,
            ),
            input: modelInput,
            signal: combined,
            onText(delta) {
              combined.throwIfAborted();
              buffer += delta;
              if (Buffer.byteLength(buffer) > 128 * 1024)
                throw Error("Scene command is too large.");
              const lines = buffer.split("\n");
              buffer = lines.pop()!;
              for (const line of lines) emit(line);
            },
          });
          emit(buffer);
          combined.throwIfAborted();
          if (!pendingCommit) throw Error("Missing final commit.");
          enqueue(pendingCommit);
        } catch {
          if (!cancelled && !combined.aborted)
            controller.enqueue(
              encoder.encode(
                JSON.stringify({
                  error:
                    "ChatGPT generation failed or was interrupted. Finished objects are preserved; retry to continue.",
                }) + "\n",
              ),
            );
        } finally {
          local.abort();
          if (!cancelled) controller.close();
        }
      },
      cancel() {
        cancelled = true;
        local.abort();
      },
    },
    { highWaterMark: 64 * 1024, size: (chunk) => chunk.byteLength },
  );
}
