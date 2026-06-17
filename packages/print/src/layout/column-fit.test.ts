import { describe, it, expect } from "vitest";
import { fitColumnsOnPage, balanceColumnHeight } from "./column-fit";
import { fitOnePage } from "./fit-core";
import type { BlockFitMeta } from "./fit-core";

/** A minimal leaf-block meta of the given height (mirrors fit-core.test.ts). */
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

/** An ifc-leaf meta with uniform line heights (a paragraph that can fragment). */
function ifcMeta(lineCount: number, lineHeight: number): BlockFitMeta {
  return {
    kind: "ifc",
    marginBlockStart: 0,
    marginBlockEnd: 0,
    breakBefore: "auto",
    breakAfter: "auto",
    breakInsideAvoid: false,
    totalBlockSize: lineCount * lineHeight,
    lineBlockSizes: Array.from({ length: lineCount }, () => lineHeight),
    orphans: 2,
    widows: 2,
  };
}

const m = (h: number) => blockMeta(h);

function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}

describe("fitColumnsOnPage", () => {
  it("columnCount 1 reduces to a single fitOnePage (single-column pages unaffected)", () => {
    const metas = [m(80), m(80), m(80)];
    const single = fitOnePage(metas, 0, null, 220, 0);
    const cols = fitColumnsOnPage(metas, 0, null, 220, 1, 0);

    expect(cols.columns).toHaveLength(1);
    expect(nth(cols.columns, 0, "column").childrenCount).toBe(single.childrenCount);
    expect(nth(cols.columns, 0, "column").resumeOut).toEqual(single.resumeOut);
    expect(cols.totalChildrenCount).toBe(single.childrenCount);
    expect(cols.listCounterAtEnd).toBe(single.listCounterAtEnd);
    // single fitOnePage placed 2 of 3 (220 fits 80+80, not 240) → page overflows.
    expect(single.childrenCount).toBe(2);
    expect(cols.pageResumeOut).not.toBeNull();
    expect(cols.pageResumeOut?.type).toBe("column");
    expect(cols.pageResumeOut?.resumeChildToken).toEqual(single.resumeOut);
  });

  it("distributes contiguous doc-order runs into columns in order, overflowing the last", () => {
    // Six 100-tall blocks, 250 per column → 2 blocks fit per column (200), a
    // third (300) overflows. col0=[0,1], col1=[2,3], page overflows at block 4.
    const metas = [m(100), m(100), m(100), m(100), m(100), m(100)];
    const r = fitColumnsOnPage(metas, 0, null, 250, 2, 0);

    expect(r.columns).toHaveLength(2);
    expect(r.columns[0]).toMatchObject({ startIndex: 0, childrenCount: 2 });
    expect(r.columns[1]).toMatchObject({ startIndex: 2, childrenCount: 2 });
    // col1's resume is where col0 stopped's successor — contiguous.
    expect(nth(r.columns, 1, "column").resumeInto).toEqual(nth(r.columns, 0, "column").resumeOut);
    expect(r.totalChildrenCount).toBe(4);
    // Page overflowed the last column → ColumnBreakToken wrapping col1's resume.
    expect(r.pageResumeOut).not.toBeNull();
    expect(r.pageResumeOut?.resumeColumnIndex).toBe(0);
    expect(r.pageResumeOut?.resumeChildToken).toEqual(nth(r.columns, 1, "column").resumeOut);
  });

  it("a single paragraph fragments across the column boundary (head in col0, tail in col1)", () => {
    // One 6-line paragraph, 200 per column → 4 lines in col0, 2 in col1.
    const metas = [ifcMeta(6, 50)];
    const r = fitColumnsOnPage(metas, 0, null, 200, 2, 0);

    // col0 holds the head — the para is NOT fully consumed (childrenCount 0) and
    // carries an inner continuation; col1 resumes from EXACTLY that token.
    expect(nth(r.columns, 0, "column").childrenCount).toBe(0);
    expect(nth(r.columns, 0, "column").resumeOut).not.toBeNull();
    expect(nth(r.columns, 1, "column").resumeInto).toEqual(nth(r.columns, 0, "column").resumeOut);
    // col1 finishes the para — one whole child consumed across the page, no overflow.
    expect(nth(r.columns, 1, "column").childrenCount).toBe(1);
    expect(nth(r.columns, 1, "column").resumeOut).toBeNull();
    expect(r.totalChildrenCount).toBe(1);
    expect(r.pageResumeOut).toBeNull();
  });

  it("short content → trailing columns are empty and the page does not overflow", () => {
    // Two 100-blocks, 250 per column, 3 columns → both fit in col0; col1, col2 empty.
    const metas = [m(100), m(100)];
    const r = fitColumnsOnPage(metas, 0, null, 250, 3, 0);

    expect(r.columns).toHaveLength(3);
    expect(nth(r.columns, 0, "column").childrenCount).toBe(2);
    expect(r.columns[1]).toMatchObject({ childrenCount: 0, resumeOut: null, consumedBlockSize: 0 });
    expect(r.columns[2]).toMatchObject({ childrenCount: 0, resumeOut: null, consumedBlockSize: 0 });
    // An empty trailing column's `resumeInto` is a block token at the EXHAUSTED index
    // (here 2), NOT `null` (#498) — materialize seeds `layoutBlock` from it, and `null`
    // would mean "start from child 0" → re-lay the whole doc into the empty column.
    expect(nth(r.columns, 1, "column").resumeInto).toEqual({ type: "block", resumeChildIndex: 2, resumeChildToken: null });
    expect(nth(r.columns, 2, "column").resumeInto).toEqual({ type: "block", resumeChildIndex: 2, resumeChildToken: null });
    expect(r.totalChildrenCount).toBe(2);
    expect(r.pageResumeOut).toBeNull();
  });

  it("the section cap (stopBeforeIndex) bounds the page; columns past the cap stay empty", () => {
    // Five blocks but only [0,1] belong to this section (cap at 2). 250/column,
    // 3 columns → col0 takes both section blocks; later columns must NOT pull
    // block 2 (the next section) — they stay empty.
    const metas = [m(100), m(100), m(100), m(100), m(100)];
    const r = fitColumnsOnPage(metas, 0, null, 250, 3, 0, /* stopBeforeIndex */ 2);

    expect(nth(r.columns, 0, "column").childrenCount).toBe(2);
    expect(nth(r.columns, 1, "column").childrenCount).toBe(0);
    expect(nth(r.columns, 2, "column").childrenCount).toBe(0);
    // Empty columns past the cap resume at the cap index (2), not 0 (#498).
    expect(nth(r.columns, 1, "column").resumeInto).toEqual({ type: "block", resumeChildIndex: 2, resumeChildToken: null });
    expect(nth(r.columns, 2, "column").resumeInto).toEqual({ type: "block", resumeChildIndex: 2, resumeChildToken: null });
    expect(r.totalChildrenCount).toBe(2);
    expect(r.pageResumeOut).toBeNull();
  });

  it("resumeInto seeds column 0 (a page continuing a prior page's overflow)", () => {
    // Page 1 overflowed at block 2; page 2 resumes there.
    const metas = [m(100), m(100), m(100), m(100)];
    const page1 = fitColumnsOnPage(metas, 0, null, 250, 2, 0); // col0=[0,1], col1=[2,3] → all fit, no overflow
    // Build a genuine overflow: tighten so page 1 overflows.
    const tight = fitColumnsOnPage(metas, 0, null, 150, 2, 0); // 1 block/column → col0=[0], col1=[1], overflow at 2
    expect(tight.pageResumeOut).not.toBeNull();
    const resumeInner = tight.pageResumeOut?.resumeChildToken ?? null;

    const page2 = fitColumnsOnPage(metas, tight.totalChildrenCount, resumeInner, 150, 2, 0);
    expect(nth(page2.columns, 0, "column").startIndex).toBe(2);
    expect(nth(page2.columns, 0, "column").childrenCount).toBe(1); // block 2
    expect(nth(page2.columns, 1, "column").childrenCount).toBe(1); // block 3
    expect(page2.pageResumeOut).toBeNull(); // document ends
    // sanity: page1 (loose) placed everything in 2 columns with no overflow.
    expect(page1.pageResumeOut).toBeNull();
  });
});

describe("balanceColumnHeight", () => {
  it("columnCount 1 → returns maxColumnHeight unchanged (no balancing)", () => {
    expect(balanceColumnHeight([m(100), m(100)], 0, null, 1, 0, 1000)).toBe(1000);
  });

  it("evens content that divides cleanly (4 blocks, 2 columns → height ≈ 2 blocks)", () => {
    const metas = [m(100), m(100), m(100), m(100)];
    const h = balanceColumnHeight(metas, 0, null, 2, 0, 1000);
    // Two 100-blocks per column ⇒ balanced height ≈ 200 (within tolerance above).
    expect(h).toBeGreaterThanOrEqual(200);
    expect(h).toBeLessThan(201);
    const r = fitColumnsOnPage(metas, 0, null, h, 2, 0);
    expect(nth(r.columns, 0, "column").childrenCount).toBe(2);
    expect(nth(r.columns, 1, "column").childrenCount).toBe(2);
    expect(r.pageResumeOut).toBeNull();
  });

  it("balances indivisible content to the minimal max (3 blocks, 2 columns → ≈ 200)", () => {
    // 3 × 100 into 2 columns: best partition is [0,1]/[2] (max 200) — cannot do
    // better given indivisible blocks; balance must NOT under-shoot to 150.
    const metas = [m(100), m(100), m(100)];
    const h = balanceColumnHeight(metas, 0, null, 2, 0, 1000);
    expect(h).toBeGreaterThanOrEqual(200);
    expect(h).toBeLessThan(201);
    const r = fitColumnsOnPage(metas, 0, null, h, 2, 0);
    expect(nth(r.columns, 0, "column").childrenCount).toBe(2); // [0,1]
    expect(nth(r.columns, 1, "column").childrenCount).toBe(1); // [2]
    expect(r.pageResumeOut).toBeNull();
  });

  it("evens SHORT content instead of dumping it into column 0 (the no-MVP case)", () => {
    // Two 100-blocks, page body 1000. FILL (height 1000) puts BOTH in column 0
    // and leaves column 1 empty. Balance must shrink the height to ≈ 100 so each
    // column gets one block.
    const metas = [m(100), m(100)];
    const fill = fitColumnsOnPage(metas, 0, null, 1000, 2, 0);
    expect(nth(fill.columns, 0, "column").childrenCount).toBe(2); // FILL dumps both into col0
    expect(nth(fill.columns, 1, "column").childrenCount).toBe(0);

    const h = balanceColumnHeight(metas, 0, null, 2, 0, 1000);
    expect(h).toBeGreaterThanOrEqual(100);
    expect(h).toBeLessThan(101);
    const r = fitColumnsOnPage(metas, 0, null, h, 2, 0);
    expect(nth(r.columns, 0, "column").childrenCount).toBe(1); // evened: one block each
    expect(nth(r.columns, 1, "column").childrenCount).toBe(1);
    expect(r.pageResumeOut).toBeNull();
  });

  it("the balanced height is stable (every column fits within it) and minimal", () => {
    const metas = [m(100), m(100)];
    const h = balanceColumnHeight(metas, 0, null, 2, 0, 1000);
    // Stable at h: no column's consumed height exceeds h.
    const at = fitColumnsOnPage(metas, 0, null, h, 2, 0);
    expect(at.columns.every((c) => c.consumedBlockSize <= h)).toBe(true);
    // Minimal: a height a hair below the block height is NOT stable — column 0
    // would be FORCED to place its 100-block, overflowing past the trial height.
    const below = fitColumnsOnPage(metas, 0, null, 99, 2, 0);
    expect(below.columns.some((c) => c.consumedBlockSize > 99)).toBe(true);
  });

  it("balances a fragmenting paragraph at line granularity (6 lines, 2 columns → ≈ 3 lines each)", () => {
    // One 6-line paragraph (300 tall), page body 1000. Balance must shrink to a
    // sub-block height (≈ 150 = 3 lines) so the paragraph splits ~evenly across
    // the two columns — proving balance works below whole-block granularity.
    const metas = [ifcMeta(6, 50)];
    const h = balanceColumnHeight(metas, 0, null, 2, 0, 1000);
    expect(h).toBeGreaterThanOrEqual(150);
    expect(h).toBeLessThan(151);
    const r = fitColumnsOnPage(metas, 0, null, h, 2, 0);
    // The single paragraph fragments: head in col0 (not fully consumed), tail
    // finishes in col1; the whole para counts once and the page does not overflow.
    expect(nth(r.columns, 0, "column").childrenCount).toBe(0);
    expect(nth(r.columns, 0, "column").resumeOut).not.toBeNull();
    expect(nth(r.columns, 1, "column").childrenCount).toBe(1);
    expect(r.pageResumeOut).toBeNull();
  });

  it("nothing to balance when a single box exceeds the page body → returns maxColumnHeight", () => {
    // A 2000-tall block can't stably fit in a 1000 page body; the page would not
    // be 'final' — the guard returns maxColumnHeight rather than searching.
    expect(balanceColumnHeight([m(2000)], 0, null, 2, 0, 1000)).toBe(1000);
  });
});
