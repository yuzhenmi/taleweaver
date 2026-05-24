import { describe, it, expect } from "vitest";
import { fitLinesInIFC, fitRowsInTable } from "../fit-core";

// Port of ifc.ts D.1–D.5 decision logic (ifc.ts:868–1013) as direct assertions
// on the pure `fitLinesInIFC`. `placedLineCount` is the number of suffix lines
// placed on this fragment (from `startLine`); `resumeAtLine` is the absolute
// 0-based line to resume at on the next fragment, or null when all suffix lines
// were placed. The "push the whole paragraph" cases (nothing fits, or
// orphans/widows/hyphen force it) yield `{ placedLineCount: 0, resumeAtLine:
// startLine }` — mirroring the real code's `{ box: null, breakToken: { ifc,
// resumeAtLine: startLine } }`.
describe("fitLinesInIFC (fit-core, IFC D.1–D.5)", () => {
  const none = undefined; // no hyphen flags

  it("all lines fit → placedLineCount = all, resumeAtLine = null", () => {
    expect(fitLinesInIFC([20, 20, 20], none, 2, 2, 100, 0)).toEqual({
      placedLineCount: 3,
      resumeAtLine: null,
    });
  });

  it("greedy partial fit honoring remaining space", () => {
    // remaining=50: lines 0,1 fit (used 40); line 2 would make 60 > 50.
    // suffixLen=4, placed=2: widows 4-2=2 not < 2; orphans 2 not < 2. → resume@2.
    expect(fitLinesInIFC([20, 20, 20, 20], none, 2, 2, 50, 0)).toEqual({
      placedLineCount: 2,
      resumeAtLine: 2,
    });
  });

  it("orphans constraint pushes the whole paragraph", () => {
    // remaining=25: only line 0 fits (next would be 40>25). placed=1 < suffixLen=3
    // and 1 < orphans=2 → push whole: placedLineCount 0, resume@startLine(0).
    expect(fitLinesInIFC([20, 20, 20], none, 2, 2, 25, 0)).toEqual({
      placedLineCount: 0,
      resumeAtLine: 0,
    });
  });

  it("widows back-off reduces placed line count", () => {
    // remaining=70, orphans=1, widows=2: D.1 places 3 (used 60, next 80>70).
    // widows: suffixLen=4, 4-3=1 < 2 → back off to 2; 4-2=2 not < 2 → stop.
    // orphans re-check: 2 < 4 && 2 < 1? no. → resume@2.
    expect(fitLinesInIFC([20, 20, 20, 20], none, 1, 2, 70, 0)).toEqual({
      placedLineCount: 2,
      resumeAtLine: 2,
    });
  });

  it("hyphen-pair back-off when last placed line ends a hyphenated pair", () => {
    // remaining=70, orphans=1, widows=1: D.1 places 3. widows ok, orphans ok.
    // hyphen: suffix[2] ends with hyphen → back off to 2; suffix[1] false → stop.
    expect(
      fitLinesInIFC([20, 20, 20, 20], [false, false, true, false], 1, 1, 70, 0),
    ).toEqual({ placedLineCount: 2, resumeAtLine: 2 });
  });

  it("nothing fits → push whole (placed 0, resume at startLine)", () => {
    expect(fitLinesInIFC([60], none, 2, 2, 50, 0)).toEqual({
      placedLineCount: 0,
      resumeAtLine: 0,
    });
  });

  it("resume from a mid-paragraph startLine considers only the suffix", () => {
    // startLine=2: suffix is lines [2,3]. remaining=100 fits both → all placed.
    expect(fitLinesInIFC([20, 20, 20, 20], none, 2, 2, 100, 2)).toEqual({
      placedLineCount: 2,
      resumeAtLine: null,
    });
  });

  it("widows back-off that stays within orphans keeps the backed-off count", () => {
    // remaining=70, orphans=2, widows=2: D.1 places 3 (60<=70, 80>70).
    // widows: 4-3=1 < 2 → back to 2; 4-2=2 not < 2 stop. orphans re-check:
    // 2 < 4 && 2 < 2? no → stays at 2 (does NOT push). resume@2.
    expect(fitLinesInIFC([20, 20, 20, 20], none, 2, 2, 70, 0)).toEqual({
      placedLineCount: 2,
      resumeAtLine: 2,
    });
  });

  it("widows back-off that re-violates orphans pushes the whole paragraph", () => {
    // remaining=40, orphans=2, widows=2: D.1 places 2 (40<=40, 60>40).
    // widows: suffixLen=3, 3-2=1 < 2 → back off to 1; 3-1=2 not < 2 → stop.
    // orphans re-check: 1 < 3 && 1 < 2 → true → push whole (placed 0, resume@0).
    expect(fitLinesInIFC([20, 20, 20], none, 2, 2, 40, 0)).toEqual({
      placedLineCount: 0,
      resumeAtLine: 0,
    });
  });
});

// Pure port of table-fc.ts E.1 row fit-check (table-fc.ts:374–408). `rowBlockSizes`
// is the full body-row height list; `startRow` is the resume index; the suffix
// considered is rows[startRow..]. No orphans/widows/header — a plain greedy pack.
describe("fitRowsInTable (fit-core, table E.1)", () => {
  it("all rows fit → placedRowCount = all, resumeAtRow = null", () => {
    expect(fitRowsInTable([30, 30, 30], 100, 0)).toEqual({
      placedRowCount: 3,
      resumeAtRow: null,
    });
  });

  it("partial fit → resume at first unplaced row", () => {
    // remaining=70: rows 0,1 fit (60); row 2 would be 90>70.
    expect(fitRowsInTable([30, 30, 30], 70, 0)).toEqual({
      placedRowCount: 2,
      resumeAtRow: 2,
    });
  });

  it("first row does not fit → push whole (placed 0, resume at startRow)", () => {
    expect(fitRowsInTable([80], 50, 0)).toEqual({
      placedRowCount: 0,
      resumeAtRow: 0,
    });
  });

  it("resume from startRow considers only the suffix (all fit)", () => {
    expect(fitRowsInTable([30, 30, 30, 30], 100, 2)).toEqual({
      placedRowCount: 2,
      resumeAtRow: null,
    });
  });

  it("resume from startRow with a partial fit", () => {
    // startRow=1 → suffix [30,30,30]; remaining=40 fits 1 (30; next 60>40).
    expect(fitRowsInTable([30, 30, 30, 30], 40, 1)).toEqual({
      placedRowCount: 1,
      resumeAtRow: 2,
    });
  });
});
