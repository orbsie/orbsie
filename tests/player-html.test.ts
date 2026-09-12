import { describe, expect, it } from "vitest";
import { playerHTML } from "../src/lib/export";

describe("standalone player HTML", () => {
  it("opts into the full viewport so safe-area CSS can protect controls", () => {
    expect(playerHTML("A test world")).toContain(
      '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">',
    );
  });
});
