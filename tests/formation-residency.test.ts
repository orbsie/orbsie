import { describe, expect, it } from "vitest";
import {
  DEFAULT_FORMATION_RESIDENT_CAP,
  selectFormationResidents,
  type FormationResidencyCandidate,
} from "../src/lib/formation-residency";

const ready = (
  id: string,
  worldCenter: readonly [number, number, number] | undefined,
): FormationResidencyCandidate => ({ id, stage: "ready", worldCenter });

describe("ready formation residency", () => {
  it("bounds 160 ready entities and orders equal-distance ties deterministically", () => {
    const candidates = Array.from({ length: 160 }, (_, index) =>
      ready(`entity-${String(index).padStart(3, "0")}`, [0, 0, 0]),
    );
    const reverse = [...candidates].reverse();
    const options = {
      focus: [0, 0, 0] as const,
      radius: 10,
      maxResidents: DEFAULT_FORMATION_RESIDENT_CAP,
    };
    const first = selectFormationResidents({ ...options, candidates });
    const second = selectFormationResidents({
      ...options,
      candidates: reverse,
    });

    expect(first.residentCount).toBe(48);
    expect(first.readyCount).toBe(160);
    expect(first.placeholderCount).toBe(112);
    expect([...first.residentIds]).toEqual([...second.residentIds]);
    expect([...first.reasonById.keys()]).toEqual(
      [...first.reasonById.keys()].toSorted(),
    );
    expect([...first.residentIds].slice(0, 3)).toEqual([
      "entity-000",
      "entity-001",
      "entity-002",
    ]);
  });

  it("moves residency with world focus and restores previous areas on revisit", () => {
    const candidates = [
      ready("west", [-1000, 0, 0]),
      ready("east", [1000, 0, 0]),
    ];
    const west = selectFormationResidents({
      candidates,
      focus: [-1000, 0, 0],
      radius: 20,
      maxResidents: 1,
    });
    const east = selectFormationResidents({
      candidates,
      focus: [1000, 0, 0],
      radius: 20,
      maxResidents: 1,
      previousResidentIds: west.residentIds,
    });
    const revisitWest = selectFormationResidents({
      candidates,
      focus: [-1000, 0, 0],
      radius: 20,
      maxResidents: 1,
      previousResidentIds: east.residentIds,
    });

    expect([...west.residentIds]).toEqual(["west"]);
    expect([...east.residentIds]).toEqual(["east"]);
    expect([...revisitWest.residentIds]).toEqual(["west"]);
    expect(revisitWest.placeholderIds.has("east")).toBe(true);
  });

  it("prioritizes selected and visible candidates over closer background objects", () => {
    const result = selectFormationResidents({
      candidates: [
        ready("near", [1, 0, 0]),
        ready("visible", [500, 0, 0]),
        ready("selected", [-500, 0, 0]),
      ],
      focus: [0, 0, 0],
      visibleIds: new Set(["visible"]),
      selectedIds: new Set(["selected"]),
      maxResidents: 2,
      radius: 10,
    });

    expect([...result.residentIds]).toEqual(["selected", "visible"]);
    expect(result.reasonById.get("selected")).toBe("resident-selected");
    expect(result.reasonById.get("visible")).toBe("resident-visible");
    expect(result.reasonById.get("near")).toBe("placeholder-capacity");
  });

  it("keeps a previous resident through ranking jitter until a challenger is clearly closer", () => {
    const first = selectFormationResidents({
      candidates: [ready("old", [5, 0, 0]), ready("new", [4.9, 0, 0])],
      focus: [0, 0, 0],
      maxResidents: 1,
      radius: 10,
      hysteresisDistance: 1,
      previousResidentIds: new Set(["old"]),
    });
    const jitter = selectFormationResidents({
      candidates: [ready("old", [5, 0, 0]), ready("new", [4.1, 0, 0])],
      focus: [0, 0, 0],
      maxResidents: 1,
      radius: 10,
      hysteresisDistance: 1,
      previousResidentIds: first.residentIds,
    });
    const decisiveMove = selectFormationResidents({
      candidates: [ready("old", [5, 0, 0]), ready("new", [3.9, 0, 0])],
      focus: [0, 0, 0],
      maxResidents: 1,
      radius: 10,
      hysteresisDistance: 1,
      previousResidentIds: jitter.residentIds,
    });

    expect([...first.residentIds]).toEqual(["old"]);
    expect([...jitter.residentIds]).toEqual(["old"]);
    expect([...decisiveMove.residentIds]).toEqual(["new"]);
  });

  it("falls back to the origin for an invalid focus and placeholders invalid centers", () => {
    const invalidCenter = Object.freeze([Number.NaN, 0, 0]) as readonly [
      number,
      number,
      number,
    ];
    const options = {
      candidates: [ready("invalid", invalidCenter), ready("valid", [1, 0, 0])],
      focus: [Number.NaN, 0, 0] as unknown as readonly [number, number, number],
      selectedIds: new Set(["invalid"]),
      radius: 10,
      maxResidents: 1,
    };
    const result = selectFormationResidents(options);

    expect(result.focusValid).toBe(false);
    expect(result.invalidCenterCount).toBe(1);
    expect([...result.residentIds]).toEqual(["valid"]);
    expect(result.placeholderIds.has("invalid")).toBe(true);
    expect(result.reasonById.get("invalid")).toBe("placeholder-invalid-center");
    expect(options.candidates[0].worldCenter).toBe(invalidCenter);
  });

  it("keeps non-ready formations outside the ready residency budget", () => {
    const result = selectFormationResidents({
      candidates: [
        { id: "forming", stage: "coarse", worldCenter: [0, 0, 0] },
        ready("ready", [0, 0, 0]),
      ],
      focus: [0, 0, 0],
      selectedIds: new Set(["forming"]),
      maxResidents: 1,
      radius: 10,
    });

    expect(result.readyCount).toBe(1);
    expect([...result.residentIds]).toEqual(["ready"]);
    expect(result.placeholderIds.has("forming")).toBe(false);
    expect(result.reasonById.get("forming")).toBe("not-ready");
  });
});
