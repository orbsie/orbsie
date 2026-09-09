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
    expect(browserModelingInstructions).toContain("partial sweep");
    expect(browserModelingInstructions).toContain("custom meshes");
    expect(browserModelingInstructions).not.toContain("lathe");
    expect(modelingInstructions(false, true)).toBe(browserModelingInstructions);
  });
});
