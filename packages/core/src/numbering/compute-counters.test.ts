import { describe, it, expect } from "vitest";
import { computeCounters } from "./compute-counters";
import type { CounterEvent, CounterDefs, CounterDef } from "./types";
import type { BlockId } from "../state";

function ev(
  blockId: string,
  scopeKey: string,
  level: number,
  breakBefore = false,
  override?: number,
): CounterEvent {
  return { blockId: blockId as BlockId, scopeKey, level, breakBefore, override };
}

function defs(entries: Record<string, CounterDef>): CounterDefs {
  return new Map(Object.entries(entries));
}

const ORDERED: CounterDef = {
  levels: Array.from({ length: 9 }, () => ({
    style: "decimal" as const,
    start: 1,
    restart: "after-break" as const,
  })),
};

describe("computeCounters", () => {
  it("numbers a single ordered list 1..N at level 0", () => {
    const events = [ev("a", "L1", 0), ev("b", "L1", 0), ev("c", "L1", 0)];
    const r = computeCounters(events, defs({ L1: ORDERED }));
    expect(r.get("a" as BlockId)).toEqual({ value: 1, formatted: "1" });
    expect(r.get("b" as BlockId)).toEqual({ value: 2, formatted: "2" });
    expect(r.get("c" as BlockId)).toEqual({ value: 3, formatted: "3" });
  });

  it("resets a deeper level on each entry and resumes the parent", () => {
    const events = [
      ev("a", "L1", 0),
      ev("b", "L1", 1),
      ev("c", "L1", 1),
      ev("d", "L1", 0),
    ];
    const r = computeCounters(events, defs({ L1: ORDERED }));
    expect(r.get("a" as BlockId)?.value).toBe(1);
    expect(r.get("b" as BlockId)?.value).toBe(1);
    expect(r.get("c" as BlockId)?.value).toBe(2);
    expect(r.get("d" as BlockId)?.value).toBe(2);
  });

  it("uses the level-specific style/start for levels > 0", () => {
    // level 0 = decimal/start-1, level 1 = lower-alpha/start-3.
    const perLevel: CounterDef = {
      levels: [
        { style: "decimal", start: 1, restart: "after-break" },
        { style: "lower-alpha", start: 3, restart: "after-break" },
      ],
    };
    const events = [ev("a", "L1", 0), ev("b", "L1", 1), ev("c", "L1", 1)];
    const r = computeCounters(events, defs({ L1: perLevel }));
    expect(r.get("a" as BlockId)).toEqual({ value: 1, formatted: "1" });
    // level 1 starts at 3 → formatted with lower-alpha: 3 = "c".
    expect(r.get("b" as BlockId)).toEqual({ value: 3, formatted: "c" });
    expect(r.get("c" as BlockId)).toEqual({ value: 4, formatted: "d" });
  });

  it("restarts numbering on breakBefore (the #425 run rule)", () => {
    const events = [
      ev("a", "L1", 0),
      ev("b", "L1", 0),
      ev("c", "L1", 0, true),
    ];
    const r = computeCounters(events, defs({ L1: ORDERED }));
    expect(r.get("b" as BlockId)?.value).toBe(2);
    expect(r.get("c" as BlockId)?.value).toBe(1);
  });

  it("keeps distinct scopes independent", () => {
    const events = [ev("a", "L1", 0), ev("b", "L2", 0), ev("c", "L1", 0)];
    const r = computeCounters(events, defs({ L1: ORDERED, L2: ORDERED }));
    expect(r.get("a" as BlockId)?.value).toBe(1);
    expect(r.get("b" as BlockId)?.value).toBe(1);
    expect(r.get("c" as BlockId)?.value).toBe(2);
  });

  it("honors per-level start", () => {
    const startsAt5: CounterDef = {
      levels: [{ style: "decimal", start: 5, restart: "after-break" }],
    };
    const r = computeCounters([ev("a", "L1", 0)], defs({ L1: startsAt5 }));
    expect(r.get("a" as BlockId)?.value).toBe(5);
  });

  it("applies an override and continues from it", () => {
    const events = [ev("a", "L1", 0), ev("b", "L1", 0, false, 10), ev("c", "L1", 0)];
    const r = computeCounters(events, defs({ L1: ORDERED }));
    expect(r.get("a" as BlockId)?.value).toBe(1);
    expect(r.get("b" as BlockId)?.value).toBe(10);
    expect(r.get("c" as BlockId)?.value).toBe(11);
  });

  it("formats with the level's style", () => {
    const alpha: CounterDef = {
      levels: [{ style: "lower-alpha", start: 1, restart: "after-break" }],
    };
    const r = computeCounters([ev("a", "L1", 0), ev("b", "L1", 0)], defs({ L1: alpha }));
    expect(r.get("a" as BlockId)?.formatted).toBe("a");
    expect(r.get("b" as BlockId)?.formatted).toBe("b");
  });

  it("falls back to decimal/start-1 when a scope has no def", () => {
    const r = computeCounters([ev("a", "MISSING", 0)], defs({}));
    expect(r.get("a" as BlockId)).toEqual({ value: 1, formatted: "1" });
  });

  it("clamps an out-of-range level to the last defined level", () => {
    const oneLevel: CounterDef = {
      levels: [{ style: "decimal", start: 1, restart: "after-break" }],
    };
    const r = computeCounters([ev("a", "L1", 5)], defs({ L1: oneLevel }));
    expect(r.get("a" as BlockId)?.value).toBe(1);
  });
});
