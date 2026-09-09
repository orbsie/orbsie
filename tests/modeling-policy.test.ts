import { describe, expect, it } from "vitest";
import {
  browserModelingInstructions,
  modelingInstructions,
} from "../src/lib/modeling-policy";

describe("browser modeling policy", () => {
  it("describes bounded full revolutions in the browser backend vocabulary", () => {
    expect(browserModelingInstructions).toContain("revolve(profile, segments)");
    expect(browserModelingInstructions).toContain(
      "full 360-degree sweep around Y",
    );
    expect(browserModelingInstructions).toContain(
      "preserving the explicit heights without automatic centering",
    );
    expect(browserModelingInstructions).toContain(
      "segments default to 32 (maximum 64)",
    );
    expect(browserModelingInstructions).toContain(
      "centered from -depth/2 to +depth/2",
    );
    expect(browserModelingInstructions).toContain("partial sweep");
    expect(browserModelingInstructions).toContain(
      "bounded closed triangle mesh",
    );
    expect(browserModelingInstructions).toContain(
      "self-intersecting triangles",
    );
    expect(browserModelingInstructions).not.toContain("lathe");
    expect(modelingInstructions(false, true)).toBe(browserModelingInstructions);
  });
});
