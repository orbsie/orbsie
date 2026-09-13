import { describe, expect, it } from "vitest";
import {
  graphicsGuidancePlatform,
  graphicsGuidanceSteps,
} from "../src/components/graphics-guidance";

describe("graphics failure guidance", () => {
  it("identifies desktop Chrome without diagnosing its acceleration setting", () => {
    expect(
      graphicsGuidancePlatform(
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36",
      ),
    ).toBe("desktop-chrome");
    expect(graphicsGuidanceSteps("desktop-chrome").join(" ")).toContain(
      "Settings → System",
    );
  });

  it("keeps mobile instructions free of the desktop setting", () => {
    const steps = graphicsGuidanceSteps("mobile").join(" ");
    expect(steps).toContain("Update or reopen your browser");
    expect(steps).toContain("not available on mobile");
    expect(steps).not.toContain("Use graphics acceleration when available");
  });

  it("does not classify Chromium alternatives as desktop Chrome", () => {
    expect(
      graphicsGuidancePlatform(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0.0.0 Edg/140.0.0.0 Safari/537.36",
      ),
    ).toBe("desktop-other");
  });
});
