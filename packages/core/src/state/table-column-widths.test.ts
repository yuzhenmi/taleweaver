import { describe, it, expect } from "vitest";
import { spliceColumnWidth, removeColumnWidth } from "./table-column-widths";

function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}

const sum = (a: readonly number[]) => a.reduce((s, w) => s + w, 0);

describe("spliceColumnWidth", () => {
  it("inserts a 1/(n+1) column and preserves the others' proportions, sum 1", () => {
    const out = spliceColumnWidth([0.5, 0.5], 1);
    expect(out).toHaveLength(3);
    expect(sum(out)).toBeCloseTo(1, 10);
    // new column = 1/3; the two originals stay equal to each other.
    expect(nth(out, 1, "column width")).toBeCloseTo(1 / 3, 10);
    expect(nth(out, 0, "column width")).toBeCloseTo(nth(out, 2, "column width"), 10);
  });

  it("inserts at the ends (0 and n) and clamps out-of-range", () => {
    expect(spliceColumnWidth([1], 0)).toHaveLength(2);
    expect(spliceColumnWidth([1], 5)).toHaveLength(2); // clamped to n
    expect(sum(spliceColumnWidth([0.3, 0.7], 0))).toBeCloseTo(1, 10);
  });

  it("preserves unequal proportions (a 2:1 table stays 2:1 between the originals)", () => {
    const out = spliceColumnWidth([2 / 3, 1 / 3], 2); // append
    expect(nth(out, 0, "column width") / nth(out, 1, "column width")).toBeCloseTo(2, 10);
  });

  it("empty input yields a single full-width column", () => {
    expect(spliceColumnWidth([], 0)).toEqual([1]);
  });
});

describe("removeColumnWidth", () => {
  it("drops the column and renormalizes to sum 1", () => {
    const out = removeColumnWidth([0.25, 0.25, 0.5], 2);
    expect(out).toHaveLength(2);
    expect(sum(out)).toBeCloseTo(1, 10);
    expect(out[0]).toBeCloseTo(0.5, 10);
    expect(out[1]).toBeCloseTo(0.5, 10);
  });

  it("out-of-range index returns a normalized copy summing to 1 (no structural change)", () => {
    for (const at of [9, -1]) {
      const out = removeColumnWidth([0.5, 0.5], at);
      expect(out).toHaveLength(2);
      expect(sum(out)).toBeCloseTo(1, 10);
    }
  });

  it("removing the last fraction yields []", () => {
    expect(removeColumnWidth([1], 0)).toEqual([]);
  });
});

describe("column-width helpers — sum stays ≈1 over many random ops (M2 drift guard)", () => {
  it("does not accumulate float drift", () => {
    // Deterministic pseudo-random sequence (no Math.random — banned + repeatable).
    let seed = 12345;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    let widths: number[] = [0.5, 0.5];
    for (let i = 0; i < 200; i++) {
      if (widths.length <= 1 || rand() < 0.5) {
        widths = spliceColumnWidth(widths, Math.floor(rand() * (widths.length + 1)));
      } else {
        widths = removeColumnWidth(widths, Math.floor(rand() * widths.length));
      }
      expect(sum(widths)).toBeCloseTo(1, 9);
      expect(widths.every((w) => w > 0)).toBe(true);
    }
  });
});
