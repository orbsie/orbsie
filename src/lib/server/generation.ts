import {
  commandSchema,
  applyOperation,
  type Project,
  type Cursor,
} from "../protocol";
import { z } from "zod";
export const commandJSONSchema = z.toJSONSchema(commandSchema);
export const systemPrompt = `You create playful, coherent 3D worlds for Orbsie. Output ONLY newline-delimited JSON, one complete command per line, without Markdown. Each line must match the provided command schema. Reserve each entity FIRST with stable ID, label, position, scale, color, stage seed. Then send set_geometry coarse and refined as separate commands. Use reusable kinds or custom parts to invent varied objects. Coordinates: x/z ground plane, y up; playable circular island radius 8, start at [0,0,5]. Keep all objects on island. Use max 70 objects, max 16 parts/object. Trees ~2 units tall. Supported behaviors: static, collect (crystal), move (platform, axis/speed/amplitude), portal (unlocks when all collect entities are collected), bloom (click), bounce. Never include code, URLs, credentials, scripts, or external assets. For object edits, preserve all unrelated entities. Conclude with commit_revision with a brief friendly message. You may only use commands matching this schema: ${JSON.stringify(commandJSONSchema)}`;
export async function generateCommands({
  provider,
  model,
  key,
  prompt,
  project,
  selected,
  signal,
}: {
  provider: "openrouter" | "gateway";
  model: string;
  key: string;
  prompt: string;
  project: Project;
  selected?: string;
  signal: AbortSignal;
}) {
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
      max_tokens: 10000,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: JSON.stringify({
            instruction: prompt,
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
    throw Error(
      response.status === 401
        ? "The API key was rejected. Check your connection."
        : response.status === 402
          ? "Your provider has no available credits."
          : response.status === 429
            ? "Your provider is busy or rate limited. Wait a moment and retry."
            : `The provider could not generate this world (${response.status}).`,
    );
  }
  return new ReadableStream({
    async start(controller) {
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      const encoder = new TextEncoder();
      let buffer = "",
        records = "",
        working = project,
        count = 0;
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
        const command = commandSchema.parse(JSON.parse(line));
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
      } catch (error) {
        controller.enqueue(
          encoder.encode(
            JSON.stringify({
              error:
                error instanceof Error && !(error instanceof z.ZodError)
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
