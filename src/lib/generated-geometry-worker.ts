import { decodeGeneratedGeometry } from "./generated-geometry-core";
import { readGeneratedModel } from "./generated-models";
const scope = globalThis as unknown as {
  onmessage: (event: MessageEvent) => void;
  postMessage: (value: unknown, transfer?: Transferable[]) => void;
};
scope.onmessage = async ({ data }) => {
  try {
    const bytes = data.bytes ?? (await readGeneratedModel(data.hash)).glb;
    const geometry = await decodeGeneratedGeometry(
      bytes,
      data.hash,
      data.maxVertices,
      data.maxGeometryBytes,
    );
    const attributes = Object.fromEntries(
      Object.entries(geometry.attributes).map(([name, a]) => [
        name,
        { array: a.array, itemSize: a.itemSize, normalized: a.normalized },
      ]),
    );
    scope.postMessage(
      {
        attributes,
        box: geometry.boundingBox,
        sphere: geometry.boundingSphere,
        userData: geometry.userData,
      },
      Object.values(attributes).map((a) => a.array.buffer as ArrayBuffer),
    );
    geometry.dispose();
  } catch (error) {
    scope.postMessage({
      error:
        error instanceof Error ? error.message : "Generated geometry failed.",
      code: (error as { code?: string })?.code ?? "parse-failed",
    });
  }
};
