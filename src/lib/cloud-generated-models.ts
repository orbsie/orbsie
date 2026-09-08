import {
  generatedModelMetadataSchema,
  readGeneratedModel,
  saveGeneratedModel,
  sameGeneratedProvenance,
  type GeneratedModelMetadata,
} from "./generated-models";
import type { Project } from "./protocol";
function references(project: Project) {
  const models = new Map<string, GeneratedModelMetadata>();
  for (const entity of project.entities) {
    if (entity.geometry?.kind !== "generated") continue;
    if (!entity.geometry.model)
      throw Error("Finish building your models before saving to your account.");
    const model = generatedModelMetadataSchema.parse(entity.geometry.model);
    const previous = models.get(model.sha256);
    if (previous && !sameGeneratedProvenance(previous, model))
      throw Error("This world's model references disagree.");
    models.set(model.sha256, model);
  }
  return models;
}
async function json(response: Response) {
  if (!response.body)
    throw Error("Cloud model storage returned an empty response.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let text = "",
    size = 0,
    done = false;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) {
        done = true;
        text += decoder.decode();
        break;
      }
      size += next.value.byteLength;
      if (size > 3 * 1024 * 1024)
        throw Error("Cloud model response exceeds its size budget.");
      text += decoder.decode(next.value, { stream: true });
    }
    const value = JSON.parse(text);
    if (!response.ok)
      throw Error(
        typeof value.error === "string"
          ? value.error
          : "Cloud model storage is unavailable.",
      );
    return value;
  } finally {
    if (!done) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
function base64(bytes: Uint8Array) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(binary);
}
export async function uploadCloudGeneratedModels(
  project: Project,
  isCurrent = () => true,
) {
  for (const expected of references(project).values()) {
    if (!isCurrent()) return false;
    const model = await readGeneratedModel(expected.sha256);
    if (!sameGeneratedProvenance(expected, model.metadata))
      throw Error("The saved model does not match this world's provenance.");
    if (!isCurrent()) return false;
    const result = await json(
      await fetch("/api/generated-models", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        redirect: "error",
        signal: AbortSignal.timeout(45000),
        body: JSON.stringify({
          metadata: model.metadata,
          glb: base64(model.glb),
        }),
      }),
    );
    if (
      !sameGeneratedProvenance(
        expected,
        generatedModelMetadataSchema.parse(result.metadata),
      )
    )
      throw Error("The cloud model identity does not match this world.");
  }
  return isCurrent();
}
/** Fetch and verify every required cloud asset before replacing the currently open world. */
export async function downloadCloudGeneratedModels(
  project: Project,
  isCurrent = () => true,
) {
  for (const expected of references(project).values()) {
    if (!isCurrent()) return false;
    const response = await json(
      await fetch(`/api/generated-models?hash=${expected.sha256}`, {
        credentials: "same-origin",
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(45000),
      }),
    );
    const metadata = generatedModelMetadataSchema.parse(response.metadata);
    if (
      !sameGeneratedProvenance(expected, metadata) ||
      typeof response.glb !== "string" ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
        response.glb,
      )
    )
      throw Error("Cloud model data does not match this world.");
    const glb = Uint8Array.from(atob(response.glb), (character) =>
      character.charCodeAt(0),
    );
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", glb));
    if (
      glb.length !== metadata.bytes ||
      [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("") !==
        metadata.sha256
    )
      throw Error("The cloud model failed its integrity check.");
    if (!isCurrent()) return false;
    await saveGeneratedModel(glb, metadata);
  }
  return isCurrent();
}
