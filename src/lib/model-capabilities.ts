export type Capability = {
  supported: boolean | "unknown";
  source: "catalog" | "provider-contract" | "unspecified";
};
export type ModelCapabilities = {
  text: Capability;
  streamingText: Capability;
  tools: Capability;
  structuredOutput: Capability;
};
const unknown = (): Capability => ({
  supported: "unknown",
  source: "unspecified",
});
export function modelCapabilities(
  model: Record<string, unknown>,
  provider: "openrouter" | "gateway",
): ModelCapabilities {
  const architecture =
    model.architecture && typeof model.architecture === "object"
      ? (model.architecture as Record<string, unknown>)
      : {};
  const modalities =
    model.modalities && typeof model.modalities === "object"
      ? (model.modalities as Record<string, unknown>)
      : {};
  const output = architecture.output_modalities ?? modalities.output;
  const text: Capability = Array.isArray(output)
    ? { supported: output.includes("text"), source: "catalog" }
    : provider === "gateway" && typeof model.type === "string"
      ? { supported: model.type === "language", source: "catalog" }
      : unknown();
  const parameters = Array.isArray(model.supported_parameters)
    ? model.supported_parameters
    : undefined;
  const tags = Array.isArray(model.tags) ? model.tags : [];
  const tools: Capability = parameters
    ? { supported: parameters.includes("tools"), source: "catalog" }
    : tags.includes("tool-use")
      ? { supported: true, source: "catalog" }
      : unknown();
  const advertisedStructuredOutput =
    parameters?.includes("structured_outputs") ||
    parameters?.includes("response_format");
  const structuredOutput: Capability = advertisedStructuredOutput
    ? { supported: true, source: "catalog" }
    : provider === "openrouter" && parameters
      ? { supported: false, source: "catalog" }
      : unknown();
  const streamingText: Capability =
    text.supported === false
      ? { supported: false, source: "catalog" }
      : provider === "openrouter" && text.supported === true
        ? { supported: true, source: "provider-contract" }
        : unknown();
  return { text, streamingText, tools, structuredOutput };
}
/** The relay validates complete NDJSON records; native tools/schema are optional. */
export function modelSupportsGeneration(model: {
  capabilities?: ModelCapabilities;
}) {
  return (
    model.capabilities?.text.supported !== false &&
    model.capabilities?.streamingText.supported !== false
  );
}
