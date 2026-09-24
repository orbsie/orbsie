import { describe, expect, it } from "vitest";
import { isAndroidEmulatorSwiftShaderRenderer } from "../src/components/world";

describe("Android emulator WebGL renderer detection", () => {
  it("recognizes the known invisible SwiftShader renderer", () => {
    expect(
      isAndroidEmulatorSwiftShaderRenderer(
        "ANGLE (Google (Google Inc.), Android Emulator OpenGL ES Translator (Google SwiftShader), OpenGL ES 3.0)",
      ),
    ).toBe(true);
  });

  it("preserves WebGL for mobile GPUs and other SwiftShader platforms", () => {
    expect(
      isAndroidEmulatorSwiftShaderRenderer(
        "ANGLE (Qualcomm, Adreno (TM) 740, OpenGL ES 3.2)",
      ),
    ).toBe(false);
    expect(
      isAndroidEmulatorSwiftShaderRenderer(
        "ANGLE (Google, SwiftShader Device (Subzero), OpenGL ES 3.0)",
      ),
    ).toBe(false);
    expect(isAndroidEmulatorSwiftShaderRenderer(undefined)).toBe(false);
  });
});
