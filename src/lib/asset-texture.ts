import * as THREE from "three";
import type { AssetBaseColorTextureTransfer } from "./asset-geometry-core";

/** Create one rendering-owned texture while sharing immutable decoded pixels. */
export function createAssetDataTexture(
  texture: AssetBaseColorTextureTransfer,
): THREE.DataTexture {
  const output = new THREE.DataTexture(
    texture.pixels,
    texture.width,
    texture.height,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  output.colorSpace = texture.colorSpace;
  output.wrapS = texture.wrapS;
  output.wrapT = texture.wrapT;
  output.magFilter = texture.magFilter;
  output.minFilter = texture.minFilter;
  output.generateMipmaps = texture.generateMipmaps;
  output.channel = texture.channel;
  output.flipY = false;
  output.unpackAlignment = 1;
  output.needsUpdate = true;
  return output;
}
