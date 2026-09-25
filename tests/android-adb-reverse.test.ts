import { describe, expect, it } from "vitest";
import { installAdbReverseWithRetry } from "../scripts/android-adb-reverse.mjs";

function bindCollision() {
  const error = new Error(
    "Command failed: adb reverse\nadb: error: cannot bind listener: Address already in use",
  );
  Object.assign(error, {
    stderr: "adb: error: cannot bind listener: Address already in use\n",
  });
  return error;
}

describe("Android ADB reverse port retry", () => {
  it("skips a colliding host port and succeeds on a fresh candidate", () => {
    const candidates = [44416, 44417];
    const chosenPorts: number[] = [];
    const installedPorts: number[] = [];
    const retries: Array<{ port: number; attempt: number }> = [];

    const port = installAdbReverseWithRetry({
      maxAttempts: 5,
      choosePort: (excludedPorts) => {
        expect([...excludedPorts]).toEqual(chosenPorts);
        const candidate = candidates[chosenPorts.length];
        chosenPorts.push(candidate);
        return candidate;
      },
      installReverse: (candidate) => {
        installedPorts.push(candidate);
        if (candidate === 44416) throw bindCollision();
      },
      onCollision: ({ port: collidedPort, attempt }) =>
        retries.push({ port: collidedPort, attempt }),
    });

    expect(port).toBe(44417);
    expect(chosenPorts).toEqual([44416, 44417]);
    expect(installedPorts).toEqual([44416, 44417]);
    expect(retries).toEqual([{ port: 44416, attempt: 1 }]);
  });

  it("fails immediately on unrelated ADB errors", () => {
    const unavailable = new Error("adb: error: device offline");
    let portSelections = 0;
    let installAttempts = 0;

    expect(() =>
      installAdbReverseWithRetry({
        choosePort: () => {
          portSelections += 1;
          return 44417;
        },
        installReverse: () => {
          installAttempts += 1;
          throw unavailable;
        },
      }),
    ).toThrow(unavailable);
    expect(portSelections).toBe(1);
    expect(installAttempts).toBe(1);
  });

  it("stops after the configured number of colliding candidates", () => {
    const candidates = [44416, 44417, 44418];
    let chosen = 0;
    let installed = 0;

    expect(() =>
      installAdbReverseWithRetry({
        maxAttempts: 3,
        choosePort: (excludedPorts) => {
          const candidate = candidates[chosen++];
          expect(excludedPorts.has(candidate)).toBe(false);
          return candidate;
        },
        installReverse: () => {
          installed += 1;
          throw bindCollision();
        },
      }),
    ).toThrow("cannot bind listener: Address already in use");
    expect(chosen).toBe(3);
    expect(installed).toBe(3);
  });
});
