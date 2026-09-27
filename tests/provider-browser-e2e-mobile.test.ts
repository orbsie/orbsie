import { afterEach, describe, expect, it } from "vitest";
import { chromium } from "@playwright/test";
import {
  browserContextViewportOptions,
  emptyReport,
  parseTestViewportMode,
  readConfiguration,
} from "../scripts/provider-browser-e2e.mjs";

const ENV_NAMES = [
  "ORBSIE_LIVE_E2E",
  "ORBSIE_TEST_VIEWPORT",
  "ORBSIE_TEST_URL",
  "ORBSIE_KEY_SCOPE",
  "ORBSIE_EXPECTED_MODEL",
  "ORBSIE_OUTPUT_CAP_TOKENS",
  "OPENROUTER_API_KEY",
];
const savedEnvironment = new Map(
  ENV_NAMES.map((name) => [name, process.env[name]]),
);

afterEach(() => {
  for (const name of ENV_NAMES) {
    const value = savedEnvironment.get(name);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

function validApiKeyConfiguration(viewport?: string) {
  for (const name of ENV_NAMES) delete process.env[name];
  Object.assign(process.env, {
    ORBSIE_LIVE_E2E: "1",
    ORBSIE_TEST_URL: "http://127.0.0.1:3018",
    ORBSIE_KEY_SCOPE: "local-only",
    ORBSIE_EXPECTED_MODEL: "openai/gpt-6-luna",
    ORBSIE_OUTPUT_CAP_TOKENS: "512",
    OPENROUTER_API_KEY: "deterministic-test-key",
    ...(viewport === undefined ? {} : { ORBSIE_TEST_VIEWPORT: viewport }),
  });
}

describe("provider browser E2E viewport mode", () => {
  it("keeps desktop defaults and reports its existing editor and player sizes", () => {
    expect(parseTestViewportMode(undefined)).toBe("desktop");
    expect(
      browserContextViewportOptions("desktop", { width: 1440, height: 1000 }),
    ).toEqual({ viewport: { width: 1440, height: 1000 } });
    expect(
      browserContextViewportOptions("desktop", { width: 1280, height: 800 }),
    ).toEqual({ viewport: { width: 1280, height: 800 } });

    validApiKeyConfiguration();
    const config = readConfiguration(["--provider", "openrouter"]);
    const report = emptyReport(config);
    expect(config.viewportMode).toBe("desktop");
    expect(report.deviceEmulation).toEqual({
      mode: "desktop",
      editor: {
        viewport: { width: 1440, height: 1000 },
        deviceScaleFactor: 1,
        isMobile: false,
        hasTouch: false,
      },
      standalone: {
        viewport: { width: 1280, height: 800 },
        deviceScaleFactor: 1,
        isMobile: false,
        hasTouch: false,
      },
    });
    expect(report.mobileLayout).toBeUndefined();
  });

  it("uses the fixed phone emulation in both browser contexts and reports it", () => {
    expect(parseTestViewportMode("mobile")).toBe("mobile");
    const expectedOptions = {
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    };
    expect(
      browserContextViewportOptions("mobile", { width: 1440, height: 1000 }),
    ).toEqual(expectedOptions);
    expect(
      browserContextViewportOptions("mobile", { width: 1280, height: 800 }),
    ).toEqual(expectedOptions);

    validApiKeyConfiguration("mobile");
    const config = readConfiguration(["--provider", "openrouter"]);
    const report = emptyReport(config);
    expect(config.viewportMode).toBe("mobile");
    expect(report.deviceEmulation).toEqual({
      mode: "mobile",
      editor: expectedOptions,
      standalone: expectedOptions,
    });
    expect(report.mobileLayout).toMatchObject({
      editor: {
        status: "not-checked",
        horizontalOverflow: null,
        connectionButtonReachable: false,
        connectionReachable: false,
        promptReachable: false,
        editPromptReachable: false,
      },
      standalone: {
        status: "not-checked",
        horizontalOverflow: null,
        movementControlReachable: false,
        touchMovementObserved: false,
      },
    });
  });

  it("keeps touch player controls visible after a CDP touch and screenshot", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext(
        browserContextViewportOptions("mobile", { width: 1280, height: 800 }),
      );
      try {
        const page = await context.newPage();
        await page.setContent(`
          <style>
            main { min-height: 100vh; }
            .controls { display: none; }
            main.touch-layout .controls { display: flex; gap: 8px; }
            button { width: 45px; height: 45px; }
          </style>
          <main>
            <div class="controls"><button aria-label="Right" type="button">→</button></div>
            <output></output>
          </main>
          <script>
            const updateTouchLayout = () => {
              const active = matchMedia("(any-pointer: coarse)").matches || navigator.maxTouchPoints > 0;
              document.querySelector("main").classList.toggle("touch-layout", active);
            };
            updateTouchLayout();
            matchMedia("(any-pointer: coarse)").addEventListener("change", updateTouchLayout);
            document.querySelector("button").addEventListener("pointerdown", () => {
              document.querySelector("output").textContent = "pressed";
            });
          </script>
        `);
        const control = page.getByRole("button", { name: "Right" });
        expect(await control.isVisible()).toBe(true);
        const box = await control.boundingBox();
        expect(box).not.toBeNull();

        const cdp = await context.newCDPSession(page);
        try {
          await cdp.send("Input.dispatchTouchEvent", {
            type: "touchStart",
            touchPoints: [
              {
                id: 1,
                x: box!.x + box!.width / 2,
                y: box!.y + box!.height / 2,
              },
            ],
          });
          expect(await page.locator("output").textContent()).toBe("pressed");
          await cdp.send("Input.dispatchTouchEvent", {
            type: "touchEnd",
            touchPoints: [],
          });
        } finally {
          await cdp.detach().catch(() => undefined);
        }

        await page.screenshot({ type: "png" });
        expect(await control.isVisible()).toBe(true);
        expect(await page.locator("main").getAttribute("class")).toContain(
          "touch-layout",
        );
        expect(
          await page.evaluate(
            () =>
              window.matchMedia("(any-pointer: coarse)").matches ||
              navigator.maxTouchPoints > 0,
          ),
        ).toBe(true);
      } finally {
        await context.close();
      }
    } finally {
      await browser.close();
    }
  }, 15000);

  it("keeps mobile mode scoped to the ordinary fresh OpenRouter journey", () => {
    validApiKeyConfiguration("mobile");
    expect(() => readConfiguration(["--provider", "gateway"])).toThrow(
      /ordinary fresh OpenRouter create\/edit\/export journey/,
    );
  });

  it.each(["", "desktop", "tablet", "Mobile"])(
    "rejects invalid viewport value %j",
    (value) => {
      expect(() => parseTestViewportMode(value)).toThrow(
        /ORBSIE_TEST_VIEWPORT must be mobile/,
      );
      validApiKeyConfiguration(value);
      expect(() => readConfiguration(["--provider", "openrouter"])).toThrow(
        /ORBSIE_TEST_VIEWPORT must be mobile/,
      );
    },
  );
});
