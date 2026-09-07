import { describe, expect, it } from "vitest";
import { claimDraftLease, releaseDraftLease } from "../src/lib/store";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
}

describe("local draft ownership", () => {
  it("keeps a second tab from silently taking an active writer lease", () => {
    const storage = memoryStorage();
    expect(claimDraftLease(storage, "orb", "tab-a", 1_000)).toBe(true);
    expect(claimDraftLease(storage, "orb", "tab-b", 10_000)).toBe(false);
    expect(claimDraftLease(storage, "orb", "tab-a", 10_000)).toBe(true);
  });

  it("lets a tab recover a stale writer lease", () => {
    const storage = memoryStorage();
    expect(claimDraftLease(storage, "orb", "old-tab", 1_000)).toBe(true);
    expect(claimDraftLease(storage, "orb", "new-tab", 46_001)).toBe(true);
  });

  it("isolates leases by world", () => {
    const storage = memoryStorage();
    expect(claimDraftLease(storage, "orb-a", "tab-a", 1_000)).toBe(true);
    expect(claimDraftLease(storage, "orb-b", "tab-b", 1_000)).toBe(true);
  });

  it("releases only the current tab's lease during navigation", () => {
    const storage = memoryStorage();
    claimDraftLease(storage, "orb", "tab-a", 1_000);
    releaseDraftLease(storage, "orb", "tab-b");
    expect(claimDraftLease(storage, "orb", "tab-b", 2_000)).toBe(false);
    releaseDraftLease(storage, "orb", "tab-a");
    expect(claimDraftLease(storage, "orb", "tab-b", 2_000)).toBe(true);
  });
});
