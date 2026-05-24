import { describe, it, expect } from "vitest";
import { fitLinesInIFC, fitRowsInTable, fitOnePage } from "../fit-core";
import type { BlockFitMeta } from "../fit-core";

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

// Direct fitOnePage contract assertions. These pin the block-packing decisions
// (margin collapse, §5.4 truncation, first-child suppression, §C.6 overflow,
// break-*) independently of the oracle-driven equivalence harness.
describe("fitOnePage (fit-core, block packing)", () => {
  it("packs whole blocks that fit; resumeOut null at doc end", () => {
    const metas = [blockMeta(50), blockMeta(50), blockMeta(50)];
    expect(fitOnePage(metas, 0, null, 1000, 0)).toEqual({
      childrenCount: 3,
      resumeOut: null,
      listCounterAtEnd: 0,
    });
  });

  it("stops at the first whole block that doesn't fit (non-empty fragment)", () => {
    // 100 each; page 250 ⇒ 2 fit, 3rd breaks.
    const metas = [blockMeta(100), blockMeta(100), blockMeta(100)];
    expect(fitOnePage(metas, 0, null, 250, 0)).toEqual({
      childrenCount: 2,
      resumeOut: { type: "block", resumeChildIndex: 2, resumeChildToken: null },
      listCounterAtEnd: 0,
    });
  });

  it("§C.6 overflow: oversize first-on-fragment block consumed whole", () => {
    const metas = [blockMeta(1000), blockMeta(1000)];
    // First block 1000 > page 500 but it's first-on-fragment ⇒ consumed whole;
    // second can't fit after ⇒ break at index 1.
    expect(fitOnePage(metas, 0, null, 500, 0)).toEqual({
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
    expect(fitOnePage([m(80), m(80), m(80)], 0, null, 220, 0)).toEqual({
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
    expect(fitOnePage([m(80), m(80), m(80)], 0, null, 200, 0)).toEqual({
      childrenCount: 2,
      resumeOut: { type: "block", resumeChildIndex: 2, resumeChildToken: null },
      listCounterAtEnd: 0,
    });
  });

  it("break-before:page on a non-first child forces a break at that child", () => {
    const metas = [blockMeta(50), blockMeta(50, { breakBefore: "page" }), blockMeta(50)];
    expect(fitOnePage(metas, 0, null, 1000, 0)).toEqual({
      childrenCount: 1,
      resumeOut: { type: "block", resumeChildIndex: 1, resumeChildToken: null },
      listCounterAtEnd: 0,
    });
  });

  it("break-before:page on the first child of a fragment is a no-op", () => {
    const metas = [blockMeta(50, { breakBefore: "page" }), blockMeta(50)];
    expect(fitOnePage(metas, 0, null, 1000, 0)).toEqual({
      childrenCount: 2,
      resumeOut: null,
      listCounterAtEnd: 0,
    });
  });

  it("break-after:page forces the NEXT child to a new page", () => {
    const metas = [blockMeta(50, { breakAfter: "page" }), blockMeta(50)];
    expect(fitOnePage(metas, 0, null, 1000, 0)).toEqual({
      childrenCount: 1,
      resumeOut: { type: "block", resumeChildIndex: 1, resumeChildToken: null },
      listCounterAtEnd: 0,
    });
  });

  it("ifc leaf fragments → nested paragraph-level resumeChildToken", () => {
    // 10 lines × 16 = 160; page 100 ⇒ 6 lines (96), resume at line 6.
    const metas = [ifcMeta(10, 16)];
    expect(fitOnePage(metas, 0, null, 100, 0)).toEqual({
      childrenCount: 0,
      resumeOut: {
        type: "block",
        resumeChildIndex: 0,
        resumeChildToken: { type: "block", resumeChildIndex: 0, resumeChildToken: { type: "ifc", resumeAtLine: 6 } },
      },
      listCounterAtEnd: 0,
    });
  });

  it("ifc leaf resumes from a paragraph-level block token", () => {
    const metas = [ifcMeta(10, 16)];
    const resumeInto = {
      type: "block" as const,
      resumeChildIndex: 0,
      resumeChildToken: { type: "block" as const, resumeChildIndex: 0, resumeChildToken: { type: "ifc" as const, resumeAtLine: 6 } },
    };
    // Remaining 4 lines (6..9) × 16 = 64, fits in page 100 ⇒ done.
    expect(fitOnePage(metas, 0, resumeInto, 100, 0)).toEqual({
      childrenCount: 1,
      resumeOut: null,
      listCounterAtEnd: 0,
    });
  });

  it("break-inside:avoid ifc leaf pushed whole to next page (non-empty fragment)", () => {
    // b0 fills 96 of 100; p1 (avoid, 4 lines × 16 = 64) won't fit ⇒ pushed whole.
    const metas = [blockMeta(96), ifcMeta(4, 16, { breakInsideAvoid: true })];
    expect(fitOnePage(metas, 0, null, 100, 0)).toEqual({
      childrenCount: 1,
      resumeOut: { type: "block", resumeChildIndex: 1, resumeChildToken: null },
      listCounterAtEnd: 0,
    });
  });

  it("break-inside:avoid ifc leaf too-tall first-on-fragment consumed whole (§C.6)", () => {
    // 30 lines × 16 = 480 > page 200; avoid + first-on-fragment ⇒ overflow whole,
    // no break.
    const metas = [ifcMeta(30, 16, { breakInsideAvoid: true })];
    expect(fitOnePage(metas, 0, null, 200, 0)).toEqual({
      childrenCount: 1,
      resumeOut: null,
      listCounterAtEnd: 0,
    });
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
        resumeChildToken: { type: "block", resumeChildIndex: 0, resumeChildToken: { type: "ifc", resumeAtLine: 0 } },
      },
    });
  });
});
