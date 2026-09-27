import { afterEach, describe, expect, it } from "vitest";
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
