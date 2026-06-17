import { describe, it, expect } from "vitest";
import { fitLinesInIFC, fitRowsInTable, fitOnePage } from "../fit-core";
import type { BlockFitMeta } from "../fit-core";
import type { SpanningCellContinuation } from "../fragmentation";
import type { BlockId } from "@taleweaver/core";

/** A minimal leaf-block meta (no inline content) of the given height. */
function blockMeta(totalBlockSize: number, extra?: Partial<BlockFitMeta>): BlockFitMeta {
  return {
    kind: "block",
    marginBlockStart: 0,
    marginBlockEnd: 0,
    breakBefore: "auto",
    breakAfter: "auto",
    breakInsideAvoid: false,
    totalBlockSize,
    children: [],
    ...extra,
  };
}

/** An ifc-leaf meta with uniform line heights. */
function ifcMeta(lineCount: number, lineHeight: number, extra?: Partial<BlockFitMeta>): BlockFitMeta {
  const lineBlockSizes = Array.from({ length: lineCount }, () => lineHeight);
  return {
    kind: "ifc",
    marginBlockStart: 0,
    marginBlockEnd: 0,
    breakBefore: "auto",
    breakAfter: "auto",
    breakInsideAvoid: false,
    totalBlockSize: lineCount * lineHeight,
    lineBlockSizes,
    orphans: 2,
    widows: 2,
    ...extra,
  };
}

/** A table-leaf meta with the given body row block-sizes. */
function tableMeta(rowBlockSizes: readonly number[], extra?: Partial<BlockFitMeta>): BlockFitMeta {
  return {
    kind: "table",
    marginBlockStart: 0,
    marginBlockEnd: 0,
    breakBefore: "auto",
    breakAfter: "auto",
    breakInsideAvoid: false,
    totalBlockSize: rowBlockSizes.reduce((a, b) => a + b, 0),
    rowBlockSizes,
    ...extra,
  };
}

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

  // #487 header-repetition reservation + PROGRESS floor (§7.3 / §6).
  it("forceProgress=false (default) is byte-identical: header args of 0/false subtract −0", () => {
    // Passing the new args at their defaults must reproduce the no-arg result.
    expect(fitRowsInTable([30, 30, 30], 70, 0, 0, false)).toEqual(
      fitRowsInTable([30, 30, 30], 70, 0),
    );
  });

  it("a resumed continuation fits fewer body rows by exactly headerBlockSize", () => {
    // rows [40, 30, 30, 30]; row 0 is a 40px header. Resume at body row 1 with
    // remaining 100 and a 40px header reservation ⇒ body fits into 100−40=60 ⇒
    // rows 1,2 (30+30=60) fit, row 3 doesn't ⇒ resume at row 3. WITHOUT the
    // reservation, 100 would fit all three body rows — proving the header ate 40.
    expect(fitRowsInTable([40, 30, 30, 30], 100, 1, 40, true)).toEqual({
      placedRowCount: 2,
      resumeAtRow: 3,
    });
    // Sanity: same remaining, no reservation ⇒ all three body rows fit.
    expect(fitRowsInTable([40, 30, 30, 30], 100, 1, 0, false)).toEqual({
      placedRowCount: 3,
      resumeAtRow: null,
    });
  });

  it("PROGRESS forces ≥1 body row when header + next row overflow the fragment", () => {
    // rows [40, 50, 50]; resume at body row 1 with remaining 60 and header 40 ⇒
    // body budget 20 < row-1 (50) ⇒ zero rows fit ⇒ forceProgress places exactly
    // ONE (overflowing) and advances resumeAtRow to 2.
    expect(fitRowsInTable([40, 50, 50], 60, 1, 40, true)).toEqual({
      placedRowCount: 1,
      resumeAtRow: 2,
    });
  });

  it("PROGRESS forces the LAST body row and resumes null (table ends)", () => {
    // rows [40, 50]; resume at body row 1, header 40, remaining 60 ⇒ body budget
    // 20 < 50 ⇒ force the single remaining body row; no more rows ⇒ resumeAtRow null.
    expect(fitRowsInTable([40, 50], 60, 1, 40, true)).toEqual({
      placedRowCount: 1,
      resumeAtRow: null,
    });
  });

  it("forceProgress=false with zero body fit still pushes whole (no force)", () => {
    // First-fragment-style call (startRow 0 ⇒ forceProgress false): zero rows fit
    // ⇒ the default push-whole result, NOT a forced row.
    expect(fitRowsInTable([80, 80], 50, 0, 0, false)).toEqual({
      placedRowCount: 0,
      resumeAtRow: 0,
    });
  });
});

// Direct fitOnePage contract assertions. These pin the block-packing decisions
// (margin collapse, §5.4 truncation, first-child suppression, §C.6 overflow,
// break-*) independently of the oracle-driven equivalence harness.
describe("fitOnePage (fit-core, block packing)", () => {
  it("packs whole blocks that fit; resumeOut null at doc end", () => {
    const metas = [blockMeta(50), blockMeta(50), blockMeta(50)];
    expect(fitOnePage(metas, 0, null, 1000, 0)).toMatchObject({
      childrenCount: 3,
      resumeOut: null,
      listCounterAtEnd: 0,
    });
  });

  it("stops at the first whole block that doesn't fit (non-empty fragment)", () => {
    // 100 each; page 250 ⇒ 2 fit, 3rd breaks.
    const metas = [blockMeta(100), blockMeta(100), blockMeta(100)];
    expect(fitOnePage(metas, 0, null, 250, 0)).toMatchObject({
      childrenCount: 2,
      resumeOut: { type: "block", resumeChildIndex: 2, resumeChildToken: null },
      listCounterAtEnd: 0,
    });
  });

  it("§C.6 overflow: oversize first-on-fragment block consumed whole", () => {
    const metas = [blockMeta(1000), blockMeta(1000)];
    // First block 1000 > page 500 but it's first-on-fragment ⇒ consumed whole;
    // second can't fit after ⇒ break at index 1.
    expect(fitOnePage(metas, 0, null, 500, 0)).toMatchObject({
      childrenCount: 1,
      resumeOut: { type: "block", resumeChildIndex: 1, resumeChildToken: null },
      listCounterAtEnd: 0,
    });
  });

  it("adjacent-sibling margin collapse uses max(prevEnd, nextStart)", () => {
    // Two 80-high blocks, prevEnd 30 / nextStart 20 ⇒ collapsed gap 30. The
    // first block's top margin (20) is §5.4-truncated to 0 (first-on-fragment).
    const m = (h: number) => blockMeta(h, { marginBlockStart: 20, marginBlockEnd: 30 });
    // offsets: 0 (1st top truncated) +80 = 80; +max(30,20)=30 → 110 +80 = 190;
    // +30 → 220 +80 = 300. page 220 fits exactly 2 (190 then 3rd would be 300).
    expect(fitOnePage([m(80), m(80), m(80)], 0, null, 220, 0)).toMatchObject({
      childrenCount: 2,
      resumeOut: { type: "block", resumeChildIndex: 2, resumeChildToken: null },
      listCounterAtEnd: 0,
    });
  });

  it("§5.4: first block on a fresh fragment has top margin truncated to 0", () => {
    // bfc's §5.4 truncation zeroes the FIRST block's top margin on a fresh
    // fragment regardless of any root/flow top boundary (this is the real,
    // load-bearing first-on-fragment rule — there is no separate noTopBoundary
    // suppression flag in the measure pass). First block top margin 40 → 0 ⇒
    // it starts at 0. Two 80-high blocks with 40 margins:
    // 0+80=80; +max(40,40)=40 →120 +80 =200. page 200 fits 2 exactly; a 3rd
    // would start at 200+40=240 > 200.
    const m = (h: number) => blockMeta(h, { marginBlockStart: 40, marginBlockEnd: 40 });
    expect(fitOnePage([m(80), m(80), m(80)], 0, null, 200, 0)).toMatchObject({
      childrenCount: 2,
      resumeOut: { type: "block", resumeChildIndex: 2, resumeChildToken: null },
      listCounterAtEnd: 0,
    });
  });

  it("break-before:page on a non-first child forces a break at that child", () => {
    const metas = [blockMeta(50), blockMeta(50, { breakBefore: "page" }), blockMeta(50)];
    expect(fitOnePage(metas, 0, null, 1000, 0)).toMatchObject({
      childrenCount: 1,
      resumeOut: { type: "block", resumeChildIndex: 1, resumeChildToken: null },
      listCounterAtEnd: 0,
    });
  });

  it("break-before:page on the first child of a fragment is a no-op", () => {
    const metas = [blockMeta(50, { breakBefore: "page" }), blockMeta(50)];
    expect(fitOnePage(metas, 0, null, 1000, 0)).toMatchObject({
      childrenCount: 2,
      resumeOut: null,
      listCounterAtEnd: 0,
    });
  });

  it("break-after:page forces the NEXT child to a new page", () => {
    const metas = [blockMeta(50, { breakAfter: "page" }), blockMeta(50)];
    expect(fitOnePage(metas, 0, null, 1000, 0)).toMatchObject({
      childrenCount: 1,
      resumeOut: { type: "block", resumeChildIndex: 1, resumeChildToken: null },
      listCounterAtEnd: 0,
    });
  });

  it("ifc leaf fragments → nested paragraph-level resumeChildToken", () => {
    // 10 lines × 16 = 160; page 100 ⇒ 6 lines (96), resume at line 6.
    const metas = [ifcMeta(10, 16)];
    expect(fitOnePage(metas, 0, null, 100, 0)).toMatchObject({
      childrenCount: 0,
      resumeOut: {
        type: "block",
        resumeChildIndex: 0,
        resumeChildToken: { type: "block", resumeChildIndex: 0, resumeChildToken: { type: "ifc", resumeAtLine: 6, paraFlowStart: 0 } },
      },
      listCounterAtEnd: 0,
    });
  });

  it("ifc leaf resumes from a paragraph-level block token", () => {
    const metas = [ifcMeta(10, 16)];
    const resumeInto = {
      type: "block" as const,
      resumeChildIndex: 0,
      resumeChildToken: { type: "block" as const, resumeChildIndex: 0, resumeChildToken: { type: "ifc" as const, resumeAtLine: 6, paraFlowStart: 0 } },
    };
    // Remaining 4 lines (6..9) × 16 = 64, fits in page 100 ⇒ done.
    expect(fitOnePage(metas, 0, resumeInto, 100, 0)).toMatchObject({
      childrenCount: 1,
      resumeOut: null,
      listCounterAtEnd: 0,
    });
  });

  it("break-inside:avoid ifc leaf pushed whole to next page (non-empty fragment)", () => {
    // b0 fills 96 of 100; p1 (avoid, 4 lines × 16 = 64) won't fit ⇒ pushed whole.
    const metas = [blockMeta(96), ifcMeta(4, 16, { breakInsideAvoid: true })];
    expect(fitOnePage(metas, 0, null, 100, 0)).toMatchObject({
      childrenCount: 1,
      resumeOut: { type: "block", resumeChildIndex: 1, resumeChildToken: null },
      listCounterAtEnd: 0,
    });
  });

  it("break-inside:avoid ifc leaf too-tall first-on-fragment consumed whole (§C.6)", () => {
    // 30 lines × 16 = 480 > page 200; avoid + first-on-fragment ⇒ overflow whole,
    // no break.
    const metas = [ifcMeta(30, 16, { breakInsideAvoid: true })];
    expect(fitOnePage(metas, 0, null, 200, 0)).toMatchObject({
      childrenCount: 1,
      resumeOut: null,
      listCounterAtEnd: 0,
    });
  });

  it("oversized resumed-table row overflow-consumes ONLY the suffix rows, not the whole table (tables-audit F2)", () => {
    // Rows [100,100,300]; rows 0,1 were placed on page 1, so this fresh page
    // resumes at row 2. Row 2 (300) is taller than the page (200) and is
    // first-on-fragment ⇒ §C.6 overflow-consume. `consumedBlockSize` must be the
    // SUFFIX height actually on THIS page (row 2 = 300), NOT the whole table
    // (500 = totalBlockSize, which double-counts rows 0,1 already consumed on
    // page 1 and would push any sibling below the table too far down).
    const metas = [tableMeta([100, 100, 300])];
    const resumeInto = {
      type: "block" as const,
      resumeChildIndex: 0,
      resumeChildToken: { type: "table" as const, resumeAtRow: 2 },
    };
    const result = fitOnePage(metas, 0, resumeInto, 200, 0);
    expect(result).toMatchObject({ childrenCount: 1, resumeOut: null, listCounterAtEnd: 0 });
    expect(result.consumedBlockSize).toBe(300);
  });

  it("oversized fresh-table row (startRow=0) overflow-consumes the whole table (§C.6, suffix == total)", () => {
    // A fresh (never-resumed) table whose only row [300] is taller than the empty
    // page (200); first-on-fragment ⇒ overflow-consume. For startRow=0 the suffix
    // sum equals totalBlockSize, so consumedBlockSize is the whole table (300) — the
    // fix preserves this case while fixing the resumed (startRow>0) double-count.
    const metas = [tableMeta([300])];
    const result = fitOnePage(metas, 0, null, 200, 0);
    expect(result).toMatchObject({ childrenCount: 1, resumeOut: null });
    expect(result.consumedBlockSize).toBe(300);
  });

  it("#487 continuation table reserves headerBlockSize: a following sibling sits below header + placed rows", () => {
    // Table rows [40(header), 30, 30, 30, 30], headerRowCount 1 ⇒ headerBlockSize
    // 40. Resume at body row 3 on a fresh page (rows 0..2 placed earlier — row 0
    // header + body 1,2). Page content 130: the header (40) is reserved, leaving
    // 90 for body ⇒ rows 3,4 fit (30+30=60). They are the LAST rows ⇒ resumeOut
    // null, the table is consumed whole on this fragment. consumedBlockSize must be
    // headerBlockSize 40 + placed 60 = 100 (NOT 60) so a sibling after the table is
    // positioned below the repeated header too.
    const metas = [
      tableMeta([40, 30, 30, 30, 30], { headerRowCount: 1, headerBlockSize: 40 }),
      blockMeta(20),
    ];
    const resumeInto = {
      type: "block" as const,
      resumeChildIndex: 0,
      resumeChildToken: { type: "table" as const, resumeAtRow: 3 },
    };
    const result = fitOnePage(metas, 0, resumeInto, 130, 0);
    // Table fully consumed (rows 3,4) + the 20px sibling block both fit on the page.
    expect(result.childrenCount).toBe(2);
    expect(result.resumeOut).toBeNull();
    // consumedBlockSize = header 40 + body rows 3,4 (60) + sibling 20 = 120.
    expect(result.consumedBlockSize).toBe(120);
  });

  it("#487 continuation table PARTIAL fit advances runningOffset by header + placed body rows", () => {
    // Same table, resume at body row 1. Page content 130, header 40 reserved ⇒
    // body budget 90 ⇒ rows 1,2,3 fit (90), row 4 doesn't ⇒ partial, resume at row
    // 4. The table is the last block on the page; consumedBlockSize = header 40 +
    // placed 90 = 130 (the full page). resumeOut points at body row 4 (absolute),
    // header NOT advancing the index.
    const metas = [tableMeta([40, 30, 30, 30, 30], { headerRowCount: 1, headerBlockSize: 40 })];
    const resumeInto = {
      type: "block" as const,
      resumeChildIndex: 0,
      resumeChildToken: { type: "table" as const, resumeAtRow: 1 },
    };
    const result = fitOnePage(metas, 0, resumeInto, 130, 0);
    expect(result.childrenCount).toBe(0); // table still fragmenting
    expect(result.consumedBlockSize).toBe(130);
    expect(result.resumeOut).toEqual({
      type: "block",
      resumeChildIndex: 0,
      resumeChildToken: { type: "table", resumeAtRow: 4 },
    });
  });

  it("#487 PROGRESS: header + next body row overflow still places exactly one body row", () => {
    // Table rows [40(header), 100, 100], headerRowCount 1. Resume at body row 1.
    // Page content 120, header 40 reserved ⇒ body budget 80 < row-1 (100) ⇒ zero
    // fit ⇒ PROGRESS forces ONE body row (overflowing) and resumes at row 2 — never
    // a hang, never the whole-suffix §C.6 dump.
    const metas = [tableMeta([40, 100, 100], { headerRowCount: 1, headerBlockSize: 40 })];
    const resumeInto = {
      type: "block" as const,
      resumeChildIndex: 0,
      resumeChildToken: { type: "table" as const, resumeAtRow: 1 },
    };
    const result = fitOnePage(metas, 0, resumeInto, 120, 0);
    expect(result.resumeOut).toEqual({
      type: "block",
      resumeChildIndex: 0,
      resumeChildToken: { type: "table", resumeAtRow: 2 },
    });
    // header 40 + the one forced (overflowing) body row 100 = 140 consumed.
    expect(result.consumedBlockSize).toBe(140);
  });

  it("#487 headerRowCount===0 (no header) is byte-identical to a plain fragmenting table", () => {
    const noHeader = [tableMeta([40, 30, 30, 30, 30])];
    const withZero = [tableMeta([40, 30, 30, 30, 30], { headerRowCount: 0, headerBlockSize: 0 })];
    const resumeInto = {
      type: "block" as const,
      resumeChildIndex: 0,
      resumeChildToken: { type: "table" as const, resumeAtRow: 1 },
    };
    expect(fitOnePage(withZero, 0, resumeInto, 130, 0)).toEqual(
      fitOnePage(noHeader, 0, resumeInto, 130, 0),
    );
  });

  it("accumulates the list-item counter through consumed blocks", () => {
    const metas = [
      blockMeta(40, { listItem: true }),
      blockMeta(40, { listItem: true }),
      blockMeta(40, { listItem: true }),
    ];
    expect(fitOnePage(metas, 0, null, 1000, 0).listCounterAtEnd).toBe(3);
  });

  it("seeds the list counter from caller-provided listCounterAtStart", () => {
    // measurePass passes the prior page's listCounterAtEnd as listCounterAtStart.
    // Resuming at child 2 with 2 already-consumed list-items ⇒ start at 2, then
    // consuming child 2 (list-item) ⇒ end at 3.
    const metas = [
      blockMeta(40, { listItem: true }),
      blockMeta(40, { listItem: true }),
      blockMeta(40, { listItem: true }),
    ];
    const resumeInto = { type: "block" as const, resumeChildIndex: 2, resumeChildToken: null };
    expect(fitOnePage(metas, 2, resumeInto, 1000, 2).listCounterAtEnd).toBe(3);
  });

  it("nested container fragments → recursive resumeChildToken (each leaf paragraph adds a block level)", () => {
    // Container of 4 ifc paragraphs (2 lines × 16 = 32 each); page 100 fits 3
    // (96); the 4th paragraph (container child index 3) can place no line on the
    // full page, so the container's break token wraps the paragraph's own
    // block-level IFC token: {block idx:3, {block idx:0, {ifc, line:0}}}. The
    // flow-level token then wraps that under the container's index 0.
    const container = blockMeta(4 * 32, {
      children: [ifcMeta(2, 16), ifcMeta(2, 16), ifcMeta(2, 16), ifcMeta(2, 16)],
    });
    const result = fitOnePage([container], 0, null, 100, 0);
    expect(result.childrenCount).toBe(0); // container is the only block, still fragmenting
    expect(result.resumeOut).toEqual({
      type: "block",
      resumeChildIndex: 0,
      resumeChildToken: {
        type: "block",
        resumeChildIndex: 3,
        // Coherent float+pagination: `paraFlowStart` is the paragraph's CUMULATIVE
        // document-flow offset. q3 is the 4th 32px paragraph in the container, so it
        // first appears at flow offset 96 (3 × 32) on this page (pageFlowBase 0). This
        // matches bfc's cumulative stamp (verified by `measure-pass-equivalence`).
        resumeChildToken: { type: "block", resumeChildIndex: 0, resumeChildToken: { type: "ifc", resumeAtLine: 0, paraFlowStart: 96 } },
      },
    });
  });

  it("padded container fragment: outer consumedBlockSize folds in the container's block padding", () => {
    // A leading spacer (30px) then a padded container so the container is NOT
    // first-on-fragment (it threads a nested resume token rather than being
    // §C.6-consumed). Container: paddingBlockStart/End 10 each, two 2-line ifc
    // paragraphs (32px each). Page content 100.
    //
    // spacer 0..30 ⇒ runningOffset 30. Container (marginStart 0, no advance):
    //   childAvailable = (100 − 30) − paddingBlockStart 10 = 60.
    //   para0 (32) fits 0..32; para1: remaining 60−32=28 ⇒ 1 line fits but widows
    //   (2) force pushing the whole paragraph ⇒ break at child idx 1, the inner
    //   flow consumed 32.
    // Reconstructed partial container height = paddingStart 10 + consumed 32 +
    //   trailingMargin 0 (paddingBlockEnd 10 ⇒ noBottomBoundary false, but the
    //   last placed child is an anon-free paragraph leaf carrying no margin) +
    //   paddingEnd 10 = 52, which fits in remaining 70 ⇒ container is last on the
    //   page. The OUTER flow's consumedBlockSize = 30 (spacer) + 52 = 82 — the
    //   container's own block padding (20) is folded in, NOT dropped. This pins
    //   `FitPageResult.consumedBlockSize` for a padded fragmenting container by
    //   value (the field a grandparent reads to reconstruct ITS partial height).
    const spacer = blockMeta(30);
    const padded = blockMeta(10 + 64 + 10, {
      children: [ifcMeta(2, 16), ifcMeta(2, 16)],
      paddingBlockStart: 10,
      paddingBlockEnd: 10,
      noBottomBoundary: false,
    });
    const result = fitOnePage([spacer, padded], 0, null, 100, 0);
    expect(result.childrenCount).toBe(1); // only the spacer is a whole block
    expect(result.consumedBlockSize).toBe(82);
    expect(result.trailingMarginBlockEnd).toBe(0);
    // Container threads its nested paragraph resume token (last block on page).
    expect(result.resumeOut).toEqual({
      type: "block",
      resumeChildIndex: 1,
      resumeChildToken: {
        type: "block",
        resumeChildIndex: 1,
        // Coherent float+pagination: `paraFlowStart` is the CUMULATIVE document-flow
        // offset of para1's first line. The container's content-box top is at flow
        // offset 40 (spacer 30 + paddingBlockStart 10); para1 sits 32 below para0, so
        // its cumulative flow start is 40 + 32 = 72. Matches bfc's cumulative stamp
        // (verified by `measure-pass-equivalence`).
        resumeChildToken: { type: "block", resumeChildIndex: 0, resumeChildToken: { type: "ifc", resumeAtLine: 0, paraFlowStart: 72 } },
      },
    });
  });
});

// Section-page-break cap (C.2b-1 T2): an optional EXCLUSIVE upper bound on the
// top-level child index this page may place. Forces a page break before the
// boundary child — exactly as if it had break-before:page — but driven by a
// parameter (the section boundary) instead of the child's own meta. The cap is
// top-level-only and never reduces what a height limit already forces.
const BIG = 100_000; // big enough that height never forces a break
describe("fitOnePage stopBeforeIndex (C.2b-1 T2, section cap)", () => {
  it("(a) caps the page at stopBeforeIndex; resumeOut points there (not null)", () => {
    const metas = [ifcMeta(1, 16), ifcMeta(1, 16), ifcMeta(1, 16), ifcMeta(1, 16)];
    const result = fitOnePage(metas, 0, null, BIG, 0, 2);
    expect(result.childrenCount).toBe(2);
    expect(result.resumeOut).toEqual({
      type: "block",
      resumeChildIndex: 2,
      resumeChildToken: null,
    });
    expect(result.listCounterAtEnd).toBe(0); // no list items
  });

  it("(b) height limit wins when the page fills before stopBeforeIndex", () => {
    // 100px page, three 80px whole-fit blocks: only the first fits (the second
    // would reach 160 > 100). stopBeforeIndex=3 is past the height-forced break,
    // so the cap is never reached — resume at the height-forced index 1.
    const metas = [blockMeta(80), blockMeta(80), blockMeta(80)];
    const result = fitOnePage(metas, 0, null, 100, 0, 3);
    expect(result.childrenCount).toBe(1);
    expect(result.resumeOut).toEqual({
      type: "block",
      resumeChildIndex: 1,
      resumeChildToken: null,
    });
  });

  it("(c) omitting stopBeforeIndex is byte-identical to today (no cap)", () => {
    const metas = [blockMeta(80), blockMeta(80), blockMeta(80)];
    const withArg = fitOnePage(metas, 0, null, BIG, 0, undefined);
    const without = fitOnePage(metas, 0, null, BIG, 0);
    expect(withArg).toEqual(without);
    // All three fit by height ⇒ no cap means everything places.
    expect(without.childrenCount).toBe(3);
    expect(without.resumeOut).toBeNull();
  });

  it("(d) stopBeforeIndex <= startIndex normalizes to no cap (== omitted)", () => {
    const metas = [blockMeta(80), blockMeta(80), blockMeta(80)];
    // Equal to startIndex (0) → no cap.
    expect(fitOnePage(metas, 0, null, BIG, 0, 0)).toEqual(
      fitOnePage(metas, 0, null, BIG, 0),
    );
    // Resuming at index 1 with a cap == startIndex (1) → no cap.
    const resumeInto = { type: "block" as const, resumeChildIndex: 1, resumeChildToken: null };
    expect(fitOnePage(metas, 1, resumeInto, BIG, 0, 1)).toEqual(
      fitOnePage(metas, 1, resumeInto, BIG, 0),
    );
  });

  it("(e) list counter counts only placed list-items; capped child not counted", () => {
    // Four list-items; cap at index 2 ⇒ place items 0,1 (counter 2). The capped
    // child at index 2 must NOT contribute (its list-item is never counted).
    const metas = [
      blockMeta(40, { listItem: true }),
      blockMeta(40, { listItem: true }),
      blockMeta(40, { listItem: true }),
      blockMeta(40, { listItem: true }),
    ];
    const result = fitOnePage(metas, 0, null, BIG, 0, 2);
    expect(result.childrenCount).toBe(2);
    expect(result.listCounterAtEnd).toBe(2);
    expect(result.resumeOut).toEqual({
      type: "block",
      resumeChildIndex: 2,
      resumeChildToken: null,
    });
  });

  it("(f) cap with a non-null resumeInto: places resumed children up to the cap", () => {
    // Page 1 placed child 0; this page resumes at child 1 (block token, no inner
    // resume). cap=3 ⇒ place children 1,2 (both fit by height), stop before 3.
    const metas = [blockMeta(80), blockMeta(80), blockMeta(80), blockMeta(80)];
    const resumeInto = { type: "block" as const, resumeChildIndex: 1, resumeChildToken: null };
    const result = fitOnePage(metas, 0, resumeInto, BIG, 0, 3);
    expect(result.childrenCount).toBe(2);
    expect(result.resumeOut).toEqual({
      type: "block",
      resumeChildIndex: 3,
      resumeChildToken: null,
    });
  });

  it("(g) cap == effectiveStartIndex (resume INTO the boundary child): cap does NOT fire, child is placed", () => {
    // The fragment-has-content gate: when the page STARTS at the boundary child
    // (effectiveStartIndex === stopBeforeIndex), that child is the first child of
    // the new section's first page and MUST be placed — not re-broken (which
    // would drop its resume token / place nothing). cap=2 with a resume into
    // child 2 ⇒ the cap is skipped, children 2 and 3 are placed.
    const metas = [blockMeta(80), blockMeta(80), blockMeta(80), blockMeta(80)];
    const resumeInto = { type: "block" as const, resumeChildIndex: 2, resumeChildToken: null };
    const result = fitOnePage(metas, 0, resumeInto, BIG, 0, 2);
    expect(result.childrenCount).toBe(2); // children 2 and 3
    expect(result.resumeOut).toBeNull(); // all remaining placed, no token dropped
  });

  it("(h) cap === metas.length is a no-op (nothing to stop before)", () => {
    const metas = [blockMeta(80), blockMeta(80), blockMeta(80)];
    const result = fitOnePage(metas, 0, null, BIG, 0, 3);
    expect(result.childrenCount).toBe(3);
    expect(result.resumeOut).toBeNull();
  });
});

describe("fitOnePage — table spanningCells pass-through (P8.S5.T2)", () => {
  // A table meta whose rows are pre-distributed [100,100,100]; the measure pass
  // only decides resumeAtRow over these, with no cell-interior knowledge.
  function tableMeta(rowBlockSizes: readonly number[]): BlockFitMeta {
    return {
      kind: "table",
      marginBlockStart: 0, marginBlockEnd: 0,
      breakBefore: "auto", breakAfter: "auto", breakInsideAvoid: false,
      totalBlockSize: rowBlockSizes.reduce((s, v) => s + v, 0),
      rowBlockSizes,
    } as unknown as BlockFitMeta;
  }

  const spanCont: SpanningCellContinuation = {
    cellId: "cellA" as BlockId,
    gridRow: 0, gridCol: 0, rowSpan: 3, colSpan: 1,
    interiorBreakToken: { type: "block", resumeChildIndex: 1, resumeChildToken: null },
  };

  it("partial fit on resume threads the incoming spanningCells into the output token", () => {
    const metas = [tableMeta([100, 100, 100])];
    // Resume into row 1 with a cell already straddling; page fits one more row.
    const resumeInto = {
      type: "block" as const,
      resumeChildIndex: 0,
      resumeChildToken: { type: "table" as const, resumeAtRow: 1, spanningCells: [spanCont] },
    };
    const res = fitOnePage(metas, 0, resumeInto, 150, 0);
    expect(res.resumeOut).toMatchObject({
      type: "block",
      resumeChildToken: { type: "table", resumeAtRow: 2, spanningCells: [spanCont] },
    });
  });

  it("a fresh table (no incoming continuation) emits NO spanningCells key", () => {
    const metas = [tableMeta([100, 100, 100])];
    const res = fitOnePage(metas, 0, null, 150, 0);
    const tok = res.resumeOut as { resumeChildToken?: { spanningCells?: unknown } } | null;
    expect(tok?.resumeChildToken?.spanningCells).toBeUndefined();
  });
});
