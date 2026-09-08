import {
  decodeAssetGeometry,
  transferableAssetGeometryBuffers,
  type AssetGeometryTransfer,
} from "./asset-geometry-core";
import { AssetGeometryError } from "./asset-geometry-error";

export interface AssetGeometryWorkerRequest {
  readonly bytes: ArrayBuffer | Uint8Array;
  readonly id: string;
  readonly maxAssetBytes: number;
  readonly maxVertices: number;
  readonly maxGeometryBytes: number;
  readonly verifyManifest: boolean;
}

export interface AssetGeometryWorkerSuccess {
  readonly decoded: AssetGeometryTransfer;
}

export interface AssetGeometryWorkerFailure {
  readonly error: string;
  readonly code: AssetGeometryError["code"];
}

export type AssetGeometryWorkerResponse =
  AssetGeometryWorkerSuccess | AssetGeometryWorkerFailure;

// Keep this entrypoint independent from the public loader and queue. A worker
// must decode its own request and never construct another worker.
const scope = globalThis as unknown as {
  onmessage: (event: MessageEvent<AssetGeometryWorkerRequest>) => void;
  postMessage: (value: unknown, transfer?: Transferable[]) => void;
};

scope.onmessage = async ({ data }) => {
  try {
    const decoded = await decodeAssetGeometry(
      data.bytes,
      data.id,
      data.maxVertices,
      data.maxGeometryBytes,
      {
        maxAssetBytes: data.maxAssetBytes,
        verifyManifest: data.verifyManifest,
      },
    );
    scope.postMessage(
      { decoded } satisfies AssetGeometryWorkerSuccess,
      transferableAssetGeometryBuffers(decoded),
    );
  } catch (error) {
    const failure: AssetGeometryWorkerFailure = {
      error:
        error instanceof Error ? error.message : "Catalog geometry failed.",
      code:
        error instanceof AssetGeometryError
          ? error.code
          : ((error as { code?: AssetGeometryError["code"] })?.code ??
            "parse-failed"),
    };
    scope.postMessage(failure);
  }
};
