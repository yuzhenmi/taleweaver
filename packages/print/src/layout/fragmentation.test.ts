// packages/core/src/layout/fragmentation.test.ts
import { describe, it, expect } from "vitest";
import { normalizeBreakValue, breakTokensEqual } from "./fragmentation";
import type {
  TableBreakToken,
  SpanningCellContinuation,
  ColumnBreakToken,
} from "./fragmentation";
import type { BlockId } from "@taleweaver/core";

describe("normalizeBreakValue", () => {
  it.each([
    ["auto", "auto"],
    ["page", "page"],
    ["always", "page"],
    ["avoid", "avoid"],
    ["avoid-page", "avoid"],
    // Unsupported values for P1.B → auto.
    ["recto", "auto"],
    ["verso", "auto"],
    ["left", "auto"],
    ["right", "auto"],
    ["column", "auto"],
    ["region", "auto"],
    ["avoid-column", "auto"],
    ["avoid-region", "auto"],
  ])("normalizes %s → %s", (raw, expected) => {
    expect(normalizeBreakValue(raw)).toBe(expected);
  });

  it("treats unknown strings as auto", () => {
    expect(normalizeBreakValue("garbage")).toBe("auto");
  });
});

describe("TableBreakToken.spanningCells (P8.S5.T1)", () => {
  it("a bare table token (no spanning cells) has spanningCells === undefined", () => {
    const tok: TableBreakToken = { type: "table", resumeAtRow: 2 };
    expect(tok.spanningCells).toBeUndefined();
    // Consumers read `?? []` → empty list, the pre-S5 behavior.
    expect(tok.spanningCells ?? []).toEqual([]);
  });

  it("accepts a spanning-cell continuation carrying grid placement + interior token", () => {
    const cont: SpanningCellContinuation = {
      cellId: "cellA" as BlockId,
      gridRow: 0,
      gridCol: 0,
      rowSpan: 3,
      colSpan: 1,
      interiorBreakToken: { type: "block", resumeChildIndex: 1, resumeChildToken: null },
    };
    const tok: TableBreakToken = { type: "table", resumeAtRow: 2, spanningCells: [cont] };
    expect(tok.spanningCells).toHaveLength(1);
    const c = (tok.spanningCells ?? [])[0];
    expect(c?.cellId).toBe("cellA");
    expect(c?.rowSpan).toBe(3);
    expect(c?.interiorBreakToken?.type).toBe("block");
  });
});

describe("breakTokensEqual — spanningCells awareness (P8.S5.T1)", () => {
  const cont = (rowSpan: number): SpanningCellContinuation => ({
    cellId: "a" as BlockId, gridRow: 0, gridCol: 0, rowSpan, colSpan: 1,
    interiorBreakToken: { type: "block", resumeChildIndex: 1, resumeChildToken: null },
  });

  it("same resumeAtRow + no spanning cells → equal (pre-S5 behavior, byte-identical)", () => {
    expect(breakTokensEqual({ type: "table", resumeAtRow: 2 }, { type: "table", resumeAtRow: 2 })).toBe(true);
  });

  it("same resumeAtRow but DIFFERENT spanning continuations → NOT equal", () => {
    const a: TableBreakToken = { type: "table", resumeAtRow: 2, spanningCells: [cont(3)] };
    const b: TableBreakToken = { type: "table", resumeAtRow: 2, spanningCells: [cont(2)] };
    expect(breakTokensEqual(a, b)).toBe(false);
  });

  it("absent spanningCells ≡ empty list (no spurious inequality)", () => {
    const a: TableBreakToken = { type: "table", resumeAtRow: 2 };
    const b: TableBreakToken = { type: "table", resumeAtRow: 2, spanningCells: [] };
    expect(breakTokensEqual(a, b)).toBe(true);
  });

  it("identical spanning continuations → equal", () => {
    const a: TableBreakToken = { type: "table", resumeAtRow: 2, spanningCells: [cont(3)] };
    const b: TableBreakToken = { type: "table", resumeAtRow: 2, spanningCells: [cont(3)] };
    expect(breakTokensEqual(a, b)).toBe(true);
  });
});

describe("breakTokensEqual — ColumnBreakToken (multi-column slice 2)", () => {
  // NOTE on guard coverage: a missing "column" arm makes `breakTokensEqual` fall
  // through to `return false` for ANY two column tokens. So only `true`-expecting
  // assertions actually fail when the arm is deleted — each test below pairs its
  // `false` case with a `true` case so the whole block guards the arm.

  it("two equal column tokens (same index, null child) → equal", () => {
    const a: ColumnBreakToken = { type: "column", resumeColumnIndex: 1, resumeChildToken: null };
    const b: ColumnBreakToken = { type: "column", resumeColumnIndex: 1, resumeChildToken: null };
    expect(breakTokensEqual(a, b)).toBe(true); // FAILS if the "column" arm is removed.
  });

  it("resumeColumnIndex is compared: equal index → equal, different index → NOT equal", () => {
    const base: ColumnBreakToken = { type: "column", resumeColumnIndex: 0, resumeChildToken: null };
    const sameIdx: ColumnBreakToken = { type: "column", resumeColumnIndex: 0, resumeChildToken: null };
    const diffIdx: ColumnBreakToken = { type: "column", resumeColumnIndex: 1, resumeChildToken: null };
    expect(breakTokensEqual(base, sameIdx)).toBe(true); // guards the arm
    expect(breakTokensEqual(base, diffIdx)).toBe(false); // a column-distribution shift must invalidate
  });

  it("recurses into the inner BFC child token: identical child → equal, differing child → NOT equal", () => {
    const withChild = (resumeChildIndex: number): ColumnBreakToken => ({
      type: "column",
      resumeColumnIndex: 2,
      resumeChildToken: {
        type: "block",
        resumeChildIndex,
        resumeChildToken: { type: "ifc", resumeAtLine: 2, paraFlowStart: 0 },
      },
    });
    expect(breakTokensEqual(withChild(3), withChild(3))).toBe(true); // deep-equal nested → equal (guards the arm + recursion)
    expect(breakTokensEqual(withChild(3), withChild(4))).toBe(false); // differing inner BFC state → NOT equal
  });

  it("a column token is never equal to a same-shaped block token (type discriminates)", () => {
    const col: ColumnBreakToken = { type: "column", resumeColumnIndex: 1, resumeChildToken: null };
    expect(breakTokensEqual(col, { type: "block", resumeChildIndex: 1, resumeChildToken: null })).toBe(
      false,
    );
  });
});

describe("breakTokensEqual — IFCBreakToken paraFlowStart (coherent float+pagination)", () => {
  it("breakTokensEqual: IFC tokens differing only in paraFlowStart are NOT equal", () => {
    const a = { type: "ifc", resumeAtLine: 2, paraFlowStart: 64 } as const;
    const b = { type: "ifc", resumeAtLine: 2, paraFlowStart: 80 } as const;
    expect(breakTokensEqual(a, b)).toBe(false);
    expect(breakTokensEqual(a, { type: "ifc", resumeAtLine: 2, paraFlowStart: 64 })).toBe(true);
  });
});
