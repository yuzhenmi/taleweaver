// packages/core/src/layout/fragmentation.test.ts
import { describe, it, expect } from "vitest";
import { normalizeBreakValue, breakTokensEqual } from "./fragmentation";
import type { TableBreakToken, SpanningCellContinuation } from "./fragmentation";
import type { BlockId } from "../state";

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
    expect(c?.interiorBreakToken.type).toBe("block");
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
