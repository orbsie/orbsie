import { z } from "zod";
import { SCENE_BINDING_VERSION } from "../scene-binding";

export const PRIVATE_SCENE_COMPLETION_VERSION = 1 as const;
export const PRIVATE_SCENE_COMPLETION_HEADER = "x-orbsie-scene-completion";
export const PRIVATE_SCENE_COMPLETION_MAX_BYTES = 2048;

const safeInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
/** Private host metadata only. Validation does not authenticate the sender. */
export const privateSceneCompletionSchema = z
  .object({
    type: z.literal("orbsie.private.scene-completion"),
    version: z.literal(PRIVATE_SCENE_COMPLETION_VERSION),
    operationId: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9_-]+$/),
    epoch: safeInteger.min(1),
    projectId: z.string().min(1).max(80),
    revision: safeInteger,
    bindingVersion: z.literal(SCENE_BINDING_VERSION),
    digest: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

export type PrivateSceneCompletion = z.infer<
  typeof privateSceneCompletionSchema
>;
export type ExpectedSceneCompletion = {
  operationId: string;
  epoch: number;
  projectId: string;
  minimumRevision: number;
};

/** Call only on negotiated, authenticated private transport; strip before forwarding. */
export function parsePrivateSceneCompletion(
  line: string,
  expected: ExpectedSceneCompletion,
): PrivateSceneCompletion {
  const invalid = () => Error("Invalid private scene completion.");
  if (
    new TextEncoder().encode(line).byteLength >
    PRIVATE_SCENE_COMPLETION_MAX_BYTES
  )
    throw invalid();
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    throw invalid();
  }
  const parsed = privateSceneCompletionSchema.safeParse(value);
  if (!parsed.success) throw invalid();
  const record = parsed.data;
  if (
    !Number.isSafeInteger(expected.minimumRevision) ||
    expected.minimumRevision < 0 ||
    record.operationId !== expected.operationId ||
    record.epoch !== expected.epoch ||
    record.projectId !== expected.projectId ||
    record.revision < expected.minimumRevision
  )
    throw invalid();
  return record;
}
