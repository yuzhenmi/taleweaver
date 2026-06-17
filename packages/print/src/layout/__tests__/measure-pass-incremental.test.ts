// packages/core/src/layout/__tests__/measure-pass-incremental.test.ts
//
// Incremental `measurePass` carry-forward (VL Phase3 T-FIX). The from-scratch
// measure pass recomputes the ENTIRE `PagePlan` on every call — O(N_blocks) per
// keystroke, O(N²) to build an N-paragraph doc one append at a time. The fix
// threads the prior `PagePlan` in as `prevPlan`; an unchanged page entry is
// REUSED (skipping `fitOnePage`) when it is provably identical at the current
// position. These tests pin three properties:
//   (A) CORRECTNESS — the incremental plan is BYTE-IDENTICAL to the from-scratch
//       one for append / middle-edit / top-insert edit shapes.
//   (B) REUSE ENGAGES — an append-at-end rebuild drives O(1..few) `fitOnePage`
//       calls (not ~N); a top-insert in an exact-fill doc does NOT spuriously
//       reuse (count ≈ full).
//   (C) BUILD SCALING — building N paragraphs by N appends drives O(N) TOTAL
//       `fitOnePage` calls incrementally vs O(N²) from scratch (the blocker).

import { describe, it, expect } from "vitest";
import {
  measurePass,
  __getFitOnePageCallCountForTest,
  __resetFitOnePageCallCountForTest,
} from "../measure-pass";
import type { PagePlan } from "../measure-pass";
import { buildBlockFitMetas } from "../build-fit-metas";
import { cascadePass, cascadePassIncremental } from "@taleweaver/core";
import { createElementBox, createTextBox } from "@taleweaver/core";
import type { ElementBox, RenderNode } from "@taleweaver/core";
import type { Style } from "@taleweaver/core";
import type { PageConfig } from "../page-config";
import { createMockShaper } from "@taleweaver/core";
import { IMPLICIT_SECTION_PLAN, type SectionPlan } from "../section-plan";
import { DEFAULT_COLUMN_CONFIG } from "@taleweaver/core";

// ---------------------------------------------------------------------------
// Fixtures + helpers
// ---------------------------------------------------------------------------

function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}

const SHAPER = createMockShaper(8, 16);
const CONTENT_INLINE = 600;

/** Console access (core tsconfig omits the DOM lib; mirror the integration tests). */
const log = (msg: string): void =>
  (globalThis as unknown as { console: { log: (...args: unknown[]) => void } }).console.log(msg);

/** A page config with no margins (content area == full page). */
function noMarginPageConfig(pageBlockSize: number, pageInlineSize = 600, pageGap = 20): PageConfig {
  return {
    pageInlineSize,
    pageBlockSize,
    pageMargins: { blockStart: 0, blockEnd: 0, inlineStart: 0, inlineEnd: 0 },
    pageGap,
  };
}

/** A paragraph render node (block whose only content is a text run). */
function paragraphNode(key: string, text: string): ElementBox {
  return createElementBox(key, { display: "block" } as Style, [
    createTextBox(`${key}-t`, {}, text),
  ]);
}

/** A multi-line (hard-wrapped) paragraph render node, used for spanning blocks. */
function multilineParagraphNode(key: string, numLines: number): ElementBox {
  const text = Array.from({ length: numLines }, () => "x").join("\n");
  return createElementBox(key, { display: "block", whiteSpace: "pre" } as Style, [
    createTextBox(`${key}-t`, { whiteSpace: "pre" }, text),
  ]);
}

/** A top-level `display:list-item` block render node. */
function listItemNode(key: string, text: string): ElementBox {
  return createElementBox(key, { display: "list-item" } as Style, [
    createTextBox(`${key}-t`, {}, text),
  ]);
}

/** A multi-line (hard-wrapped) `display:list-item` block, used for spanning list-items. */
function multilineListItemNode(key: string, numLines: number): ElementBox {
  const text = Array.from({ length: numLines }, () => "x").join("\n");
  return createElementBox(key, { display: "list-item", whiteSpace: "pre" } as Style, [
    createTextBox(`${key}-t`, { whiteSpace: "pre" }, text),
  ]);
}

function docRoot(children: readonly RenderNode[]): ElementBox {
  return createElementBox("doc", { display: "block" } as Style, children);
}

function cascadeRoot(root: ElementBox): ElementBox {
  const c = cascadePass(root);
  if (c.type !== "element") throw new Error("cascadePass returned non-element");
  return c;
}

/** Build a `PagePlan` from a cascaded root (optionally with a prior plan). */
function planFrom(cascaded: ElementBox, pageConfig: PageConfig, prevPlan?: PagePlan): PagePlan {
  const metas = buildBlockFitMetas(cascaded, SHAPER, undefined, CONTENT_INLINE);
  return measurePass(metas, pageConfig, IMPLICIT_SECTION_PLAN, cascaded.children, prevPlan);
}

// ---------------------------------------------------------------------------
// Plan deep-equality (the incremental plan MUST be byte-identical to scratch).
// Compares every field the consumers read, plus the per-block index/span maps.
// `children` are compared by REFERENCE identity (the incremental path must
// carry forward the SAME RenderNode refs), which we assert separately from the
// rest of the entry.
// ---------------------------------------------------------------------------

function assertPlansIdentical(a: PagePlan, b: PagePlan, root: ElementBox): void {
  expect(a.entries.length, "entry count").toBe(b.entries.length);
  expect(a.totalBlockSize, "totalBlockSize").toBe(b.totalBlockSize);
  expect(a.pageInlineSize, "pageInlineSize").toBe(b.pageInlineSize);

  for (let i = 0; i < a.entries.length; i++) {
    const ea = nth(a.entries, i, "plan-a entry");
    const eb = nth(b.entries, i, "plan-b entry");
    expect(ea.pageIndex, `page ${i} pageIndex`).toBe(eb.pageIndex);
    expect(ea.blockOffset, `page ${i} blockOffset`).toBe(eb.blockOffset);
    expect(ea.blockSize, `page ${i} blockSize`).toBe(eb.blockSize);
    expect(ea.startIndex, `page ${i} startIndex`).toBe(eb.startIndex);
    expect(ea.listCounterAtStart, `page ${i} listCounterAtStart`).toBe(eb.listCounterAtStart);
    // Resume tokens: deep value-equal (references differ across cycles).
    expect(ea.resumeInto, `page ${i} resumeInto`).toEqual(eb.resumeInto);
    expect(ea.resumeOut, `page ${i} resumeOut`).toEqual(eb.resumeOut);
    // Children: same length AND same REFERENCES (carry-forward must preserve
    // RenderNode identity so paint-cache / LineIndex warmth survives).
    expect(ea.children.length, `page ${i} children length`).toBe(eb.children.length);
    for (let j = 0; j < ea.children.length; j++) {
      expect(nth(ea.children, j, "child"), `page ${i} child ${j} ref`).toBe(nth(eb.children, j, "child"));
    }
  }

  // pageIndexOfBlock / pageSpanOfBlock parity for every top-level block key.
  for (const child of root.children) {
    expect(a.pageIndexOfBlock(child.key), `pageIndexOfBlock ${child.key}`).toBe(
      b.pageIndexOfBlock(child.key),
    );
    expect(a.pageSpanOfBlock(child.key), `pageSpanOfBlock ${child.key}`).toEqual(
      b.pageSpanOfBlock(child.key),
    );
  }
}

// ---------------------------------------------------------------------------
// (A) CORRECTNESS — incremental == from-scratch for several edit shapes.
// We build plan A from scratch, mutate the render tree (re-cascade
// INCREMENTALLY so unchanged blocks keep refs), then build plan B WITH
// prevPlan=A and plan B' WITHOUT prevPlan. B must deep-equal B'.
// ---------------------------------------------------------------------------

describe("measurePass incremental — (A) incremental == from-scratch", () => {
  // 10 single-line paragraphs of 16px each; page content 48 ⇒ 3 lines/page.
  function tenParagraphRender(): ElementBox {
    return docRoot(Array.from({ length: 10 }, (_, i) => paragraphNode(`p${i}`, `para ${i}`)));
  }
  const PAGE = noMarginPageConfig(48);

  it("append a paragraph at the end", () => {
    const render0 = tenParagraphRender();
    const cascaded0 = cascadeRoot(render0);
    const planA = planFrom(cascaded0, PAGE);

    // Append p10. Reuse the SAME child refs for p0..p9; only the array is new.
    const render1 = docRoot([...render0.children, paragraphNode("p10", "para 10")]);
    const cascaded1 = cascadePassIncremental(render1, render0, cascaded0) as ElementBox;

    const planIncremental = planFrom(cascaded1, PAGE, planA);
    const planScratch = planFrom(cascaded1, PAGE);
    assertPlansIdentical(planIncremental, planScratch, cascaded1);
  });

  it("edit a middle paragraph (changes its text, not its line count)", () => {
    const render0 = tenParagraphRender();
    const cascaded0 = cascadeRoot(render0);
    const planA = planFrom(cascaded0, PAGE);

    // Replace p5 with a fresh node (different text, same single-line height).
    const render1 = docRoot(
      render0.children.map((c, i) => (i === 5 ? paragraphNode("p5", "EDITED") : c)),
    );
    const cascaded1 = cascadePassIncremental(render1, render0, cascaded0) as ElementBox;

    const planIncremental = planFrom(cascaded1, PAGE, planA);
    const planScratch = planFrom(cascaded1, PAGE);
    assertPlansIdentical(planIncremental, planScratch, cascaded1);
  });

  it("insert a paragraph at the TOP (shifts every subsequent block)", () => {
    const render0 = tenParagraphRender();
    const cascaded0 = cascadeRoot(render0);
    const planA = planFrom(cascaded0, PAGE);

    const render1 = docRoot([paragraphNode("pNew", "inserted"), ...render0.children]);
    const cascaded1 = cascadePassIncremental(render1, render0, cascaded0) as ElementBox;

    const planIncremental = planFrom(cascaded1, PAGE, planA);
    const planScratch = planFrom(cascaded1, PAGE);
    assertPlansIdentical(planIncremental, planScratch, cascaded1);
  });

  it("append after a SPANNING block (multi-line paragraph crossing a boundary)", () => {
    // p0 spans: 5 lines × 16 = 80 > page content 48 ⇒ p0 occupies pages 0 & 1.
    // Then single-line paragraphs. Appending at the end must still reuse the
    // earlier pages (including the spanning-block boundary) byte-for-byte.
    const render0 = docRoot([
      multilineParagraphNode("span", 5),
      ...Array.from({ length: 6 }, (_, i) => paragraphNode(`p${i}`, `para ${i}`)),
    ]);
    const cascaded0 = cascadeRoot(render0);
    const planA = planFrom(cascaded0, PAGE);

    const render1 = docRoot([...render0.children, paragraphNode("tail", "tail")]);
    const cascaded1 = cascadePassIncremental(render1, render0, cascaded0) as ElementBox;

    const planIncremental = planFrom(cascaded1, PAGE, planA);
    const planScratch = planFrom(cascaded1, PAGE);
    assertPlansIdentical(planIncremental, planScratch, cascaded1);
  });

  it("append a list-item preserves cross-page list-counter seeds", () => {
    // 9 list-items of one line each; page content 48 ⇒ 3 items/page ⇒ seeds
    // 0,3,6. Append a 10th — the incremental plan's per-page listCounterAtStart
    // must match the from-scratch plan exactly.
    const render0 = docRoot(Array.from({ length: 9 }, (_, i) => listItemNode(`li${i}`, `item ${i}`)));
    const cascaded0 = cascadeRoot(render0);
    const planA = planFrom(cascaded0, PAGE);

    const render1 = docRoot([...render0.children, listItemNode("li9", "item 9")]);
    const cascaded1 = cascadePassIncremental(render1, render0, cascaded0) as ElementBox;

    const planIncremental = planFrom(cascaded1, PAGE, planA);
    const planScratch = planFrom(cascaded1, PAGE);
    assertPlansIdentical(planIncremental, planScratch, cascaded1);
    // Sanity: the seeds are actually non-trivial (so the test exercises the path).
    expect(planScratch.entries.map((e) => e.listCounterAtStart)).toEqual([0, 3, 6, 9]);
  });

  it("append after a SPANNING list-item preserves mid-fragment counter delta", () => {
    // A MULTI-LINE `display:list-item` that fragments across a page boundary,
    // followed by more list-items. The reuse path reads each reused page's
    // list-counter increment off `prevNext.listCounterAtStart −
    // reusable.listCounterAtStart` (the impl's mid-fragment delta path); a
    // spanning list-item exercises that path — the spanning item contributes its
    // single whole-block-progress count on the page it FINISHES, so the pages
    // after it must seed at the correct counter. Append at the end with prevPlan
    // and assert the incremental plan deep-equals the from-scratch plan,
    // especially `listCounterAtStart` on the pages after the spanning item.
    // 5 lines × 16 = 80 > page content 48 ⇒ the multi-line list-item occupies
    // pages 0 & 1 (whitespace:pre keeps the hard-wrapped lines distinct).
    const render0 = docRoot([
      multilineListItemNode("liSpan", 5),
      ...Array.from({ length: 6 }, (_, i) => listItemNode(`li${i}`, `item ${i}`)),
    ]);
    const cascaded0 = cascadeRoot(render0);
    const planA = planFrom(cascaded0, PAGE);

    const render1 = docRoot([...render0.children, listItemNode("liTail", "tail")]);
    const cascaded1 = cascadePassIncremental(render1, render0, cascaded0) as ElementBox;

    const planIncremental = planFrom(cascaded1, PAGE, planA);
    const planScratch = planFrom(cascaded1, PAGE);
    assertPlansIdentical(planIncremental, planScratch, cascaded1);
    // Sanity: the spanning list-item actually crosses a page boundary (so the
    // mid-fragment counter-delta path is exercised), and the seeds are
    // non-trivial after it.
    expect(planScratch.entries.length).toBeGreaterThan(2);
    expect(planScratch.pageSpanOfBlock("liSpan")).toEqual({ first: 0, last: 1 });
    expect(new Set(planScratch.entries.map((e) => e.listCounterAtStart)).size).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// (A2) GEOMETRY-MISMATCH GUARD — a prevPlan fitted at a DIFFERENT page content
// block-size must be refused entirely (no stale-boundary reuse). The carry-
// forward proves CONTENT is unchanged but never re-derives the boundary against
// the current page geometry, so a `pageContentBlockSize` mismatch forces a full
// from-scratch re-fit. Not triggerable in today's API (pageConfig is static),
// but a latent footgun guarded by `PagePlan.pageContentBlockSize`.
// ---------------------------------------------------------------------------

describe("measurePass incremental — (A2) refuses prevPlan on page-geometry change", () => {
  it("a prevPlan built at a different pageBlockSize is ignored (full re-fit)", () => {
    const render = docRoot(Array.from({ length: 10 }, (_, i) => paragraphNode(`p${i}`, `para ${i}`)));
    const cascaded = cascadeRoot(render);

    // Plan A at page content 48 (3 lines/page). Plan B asks for content 32 (2
    // lines/page) but passes A as prevPlan — the geometry differs, so A must be
    // refused and B must equal a from-scratch build at the NEW size.
    const PAGE_A = noMarginPageConfig(48);
    const PAGE_B = noMarginPageConfig(32);

    const planA = planFrom(cascaded, PAGE_A);
    expect(planA.pageContentBlockSize).toBe(48);

    const planWithStalePrev = planFrom(cascaded, PAGE_B, planA);
    const planScratchAtB = planFrom(cascaded, PAGE_B);

    // The plan threaded with the mismatched prevPlan must be byte-identical to a
    // from-scratch build at the new size — i.e. the stale prevPlan was refused.
    assertPlansIdentical(planWithStalePrev, planScratchAtB, cascaded);
    expect(planWithStalePrev.pageContentBlockSize).toBe(32);
    // Sanity: the two geometries actually produce different page counts, so the
    // test would FAIL loudly if stale boundaries leaked through.
    expect(planA.entries.length).not.toBe(planScratchAtB.entries.length);
  });
});

// ---------------------------------------------------------------------------
// (B) REUSE ENGAGES — instrument the `fitOnePage`-call counter.
// ---------------------------------------------------------------------------

describe("measurePass incremental — (B) reuse engages / does not over-fire", () => {
  // 180 single-line paragraphs; page content 48 ⇒ 3 lines/page ⇒ 60 pages.
  function bigRender(): ElementBox {
    return docRoot(Array.from({ length: 180 }, (_, i) => paragraphNode(`p${i}`, `para ${i}`)));
  }
  const PAGE = noMarginPageConfig(48);

  it("append at end re-fits ~1 page, NOT ~60", () => {
    const render0 = bigRender();
    const cascaded0 = cascadeRoot(render0);
    const planA = planFrom(cascaded0, PAGE);
    expect(planA.entries.length).toBe(60); // 180 / 3.

    const render1 = docRoot([...render0.children, paragraphNode("p180", "para 180")]);
    const cascaded1 = cascadePassIncremental(render1, render0, cascaded0) as ElementBox;
    const metas1 = buildBlockFitMetas(cascaded1, SHAPER, undefined, CONTENT_INLINE);

    __resetFitOnePageCallCountForTest();
    measurePass(metas1, PAGE, IMPLICIT_SECTION_PLAN, cascaded1.children, planA);
    const fitCalls = __getFitOnePageCallCountForTest();

    // Only the trailing dirty page(s) re-fit — a small constant, NOT ~60.
    expect(fitCalls).toBeGreaterThan(0);
    expect(fitCalls).toBeLessThanOrEqual(5);
  });

  it("a from-scratch build (no prevPlan) re-fits every page (~60)", () => {
    const cascaded = cascadeRoot(bigRender());
    const metas = buildBlockFitMetas(cascaded, SHAPER, undefined, CONTENT_INLINE);

    __resetFitOnePageCallCountForTest();
    measurePass(metas, PAGE, IMPLICIT_SECTION_PLAN, cascaded.children);
    expect(__getFitOnePageCallCountForTest()).toBe(60);
  });

  it("top-insert in an exact-fill doc does NOT spuriously reuse (count ≈ full)", () => {
    // Every page is exactly filled (3 lines/page), so inserting a paragraph at
    // index 0 shifts every block by one — each page's startIndex changes, so
    // NOTHING reuses and the whole plan re-fits.
    const render0 = bigRender();
    const cascaded0 = cascadeRoot(render0);
    const planA = planFrom(cascaded0, PAGE);

    const render1 = docRoot([paragraphNode("pTop", "top"), ...render0.children]);
    const cascaded1 = cascadePassIncremental(render1, render0, cascaded0) as ElementBox;
    const metas1 = buildBlockFitMetas(cascaded1, SHAPER, undefined, CONTENT_INLINE);

    __resetFitOnePageCallCountForTest();
    const planB = measurePass(metas1, PAGE, IMPLICIT_SECTION_PLAN, cascaded1.children, planA);
    const fitCalls = __getFitOnePageCallCountForTest();

    // 181 paragraphs ⇒ 61 pages; the top-insert shifts all of them ⇒ a full
    // re-fit (one fitOnePage per page). Allow the exact page count.
    expect(fitCalls).toBe(planB.entries.length);
    expect(planB.entries.length).toBe(61);
  });

  it("edit a block on page 0 only re-fits page 0, reuses the tail", () => {
    // A middle-of-page-0 text edit (no line-count change) leaves every later
    // page's (startIndex, resumeInto, child refs) identical ⇒ only page 0
    // re-fits.
    const render0 = bigRender();
    const cascaded0 = cascadeRoot(render0);
    const planA = planFrom(cascaded0, PAGE);

    const render1 = docRoot(
      render0.children.map((c, i) => (i === 1 ? paragraphNode("p1", "EDITED") : c)),
    );
    const cascaded1 = cascadePassIncremental(render1, render0, cascaded0) as ElementBox;
    const metas1 = buildBlockFitMetas(cascaded1, SHAPER, undefined, CONTENT_INLINE);

    __resetFitOnePageCallCountForTest();
    measurePass(metas1, PAGE, IMPLICIT_SECTION_PLAN, cascaded1.children, planA);
    expect(__getFitOnePageCallCountForTest()).toBeLessThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// (D) COLUMN-CONFIG REUSE GATE (multi-column wiring T2/T3) — a change in the
// effective `ColumnConfig` between two measure cycles MUST refuse per-page reuse
// and re-fit every affected page, exactly as a `pageConfig` change does. Since
// T3 the column config DRIVES the fit (`fitColumnsOnPage` on multicol pages), so
// flipping to 2 columns both re-fits AND re-packs the content (a 2-column page
// holds twice the single-column content ⇒ ~half the page count). The unchanged-
// config case still reuses (the column gate is equal so it adds no misses).
//
// NOTE on the fit-call counter: `_fitOnePageCallCount` instruments the SINGLE-
// COLUMN branch only — `fitColumnsOnPage`'s internal `fitOnePage` calls are NOT
// counted (T3 M-1). So a 2-column re-fit drives the counter to 0; the observable
// that the column change actually re-fit (not spurious-reuse) is that the page
// COUNT changed and every page carries a `columnFit`.
// ---------------------------------------------------------------------------

describe("measurePass incremental — (D) column-config change refuses reuse", () => {
  function bigRender(): ElementBox {
    return docRoot(Array.from({ length: 180 }, (_, i) => paragraphNode(`p${i}`, `para ${i}`)));
  }
  const PAGE = noMarginPageConfig(48); // 3 lines/page (single-column) ⇒ 60 pages.

  const twoColumnPlan: SectionPlan = {
    boundaries: [{ startFlattenedIndex: 0, sectionId: null }],
    effectiveDefaultColumns: { columnCount: 2, columnGap: 48, columnRule: null },
  };

  it("a doc-wide column-count change between cycles re-fits + re-packs every page (no spurious reuse)", () => {
    const cascaded = cascadeRoot(bigRender());
    const metas = buildBlockFitMetas(cascaded, SHAPER, undefined, CONTENT_INLINE);

    // Cycle 1: single-column (DEFAULT_COLUMN_CONFIG) ⇒ 60 pages, no columnFit.
    const planA = measurePass(metas, PAGE, IMPLICIT_SECTION_PLAN, cascaded.children);
    expect(planA.entries.length).toBe(60);
    expect(nth(planA.entries, 0, "plan entry").columnConfig).toEqual(DEFAULT_COLUMN_CONFIG);
    expect(nth(planA.entries, 0, "plan entry").columnFit).toBeUndefined();

    // Cycle 2: SAME content/metas, but the effective default flips to 2 columns.
    // The per-page reuse gate must refuse (no spurious reuse), AND since T3 the
    // column fit packs 2 columns/page ⇒ the page count halves to 30 and every
    // page carries a `columnFit`. (The single-column instrument stays 0 — the
    // multicol fit's internal calls are uncounted, T3 M-1.)
    __resetFitOnePageCallCountForTest();
    const planB = measurePass(metas, PAGE, twoColumnPlan, cascaded.children, planA);
    expect(__getFitOnePageCallCountForTest()).toBe(0);
    expect(planB.entries.length).toBe(30);
    for (const e of planB.entries) {
      expect(e.columnConfig.columnCount).toBe(2);
      expect(e.columnFit).toBeDefined();
    }
  });

  it("an unchanged column-config between cycles still reuses (gate does not over-fire)", () => {
    const cascaded = cascadeRoot(bigRender());
    const metas = buildBlockFitMetas(cascaded, SHAPER, undefined, CONTENT_INLINE);

    // Both cycles use the SAME 2-column plan + identical content ⇒ every page is
    // reusable; the column gate is equal so it adds no misses. The single-column
    // instrument stays 0 either way (multicol pages use the uncounted fit), so
    // the meaningful reuse signal is that the SECOND cycle copies the prior
    // entries (it returns the same 30-page plan with their columnFit carried).
    const planA = measurePass(metas, PAGE, twoColumnPlan, cascaded.children);
    expect(planA.entries.length).toBe(30);
    __resetFitOnePageCallCountForTest();
    const planB = measurePass(metas, PAGE, twoColumnPlan, cascaded.children, planA);
    expect(__getFitOnePageCallCountForTest()).toBe(0);
    expect(planB.entries.length).toBe(30);
    // The carried column distributions are the prior cycle's (reuse engaged).
    for (let i = 0; i < planB.entries.length; i++) {
      expect(nth(planB.entries, i, "plan-b entry").columnFit).toBe(nth(planA.entries, i, "plan-a entry").columnFit);
    }
  });
});

// ---------------------------------------------------------------------------
// (C) BUILD SCALING — the BLOCKER this fix targets is the `fitOnePage`-per-page
// re-fit on every keystroke: building N paragraphs by N appends drove
// O(N_blocks) `fitOnePage` calls PER append ⇒ O(N²) `fitOnePage` work, which
// froze the browser. The incremental carry-forward reduces `fitOnePage` to
// O(dirty) per append (a small constant), so the EXPENSIVE part of the measure
// pass no longer scales with N.
//
// We drive the exact incremental workload — append a render node, incremental-
// cascade (unchanged blocks keep refs), then `buildBlockFitMetas` + `measurePass`
// with the prior plan threaded in — for `incremental` vs from-scratch, and pin:
//   (1) the incremental build's TOTAL `fitOnePage` calls grow ~LINEARLY with N
//       (≈ O(N): a small constant per append), NOT quadratically as the
//       from-scratch path does (≈ N × pages ≈ O(N²)); and
//   (2) wall-clock TIME for the incremental build is materially less than the
//       from-scratch build at the same N (the fitOnePage elimination is the win).
//
// What this fix does NOT change: `measurePass` still allocates the full plan
// (per-page children slices + the `blockToPage` / `blockToSpan` maps) on every
// call, an O(pages + blocks) scaffolding cost independent of reuse. So the
// measure pass remains super-linear over a full N-append build — but with the
// O(N²) `fitOnePage` term removed, leaving only the much cheaper scaffolding.
// Driving that scaffolding to O(dirty) (incremental plan mutation) and the OTHER
// per-keystroke pipeline stages (render / cascade / materialization) are
// separate tasks; this test scopes the measure pass's `fitOnePage` blowup.
// ---------------------------------------------------------------------------

describe("measurePass incremental — (C) fitOnePage work no longer scales with N", () => {
  const PAGE = noMarginPageConfig(48); // 3 lines/page.

  /**
   * Append paragraphs one at a time up to `n`, re-cascading incrementally and
   * running `buildBlockFitMetas` + `measurePass` each step. When `incremental`,
   * the prior plan is threaded in (the fix under test); otherwise every step
   * re-fits from scratch (the old behavior). Returns the total `fitOnePage` call
   * count across the build AND the total ms spent in metas + measure-pass.
   */
  function appendBuild(n: number, incremental: boolean): { fitCalls: number; ms: number } {
    let render0 = docRoot([paragraphNode("p0", "para 0")]);
    let cascaded = cascadeRoot(render0);
    let plan = measurePass(
      buildBlockFitMetas(cascaded, SHAPER, undefined, CONTENT_INLINE),
      PAGE,
      IMPLICIT_SECTION_PLAN,
      cascaded.children,
    );

    let ms = 0;
    __resetFitOnePageCallCountForTest();
    for (let i = 1; i < n; i++) {
      const render1 = docRoot([...render0.children, paragraphNode(`p${i}`, `para ${i}`)]);
      const cascaded1 = cascadePassIncremental(render1, render0, cascaded) as ElementBox;
      const start = performance.now();
      const metas1 = buildBlockFitMetas(cascaded1, SHAPER, undefined, CONTENT_INLINE);
      plan = measurePass(metas1, PAGE, IMPLICIT_SECTION_PLAN, cascaded1.children, incremental ? plan : undefined);
      ms += performance.now() - start;
      render0 = render1;
      cascaded = cascaded1;
    }
    return { fitCalls: __getFitOnePageCallCountForTest(), ms };
  }

  it("incremental: total fitOnePage calls grow ~linearly, NOT quadratically", () => {
    // Incremental — each append re-fits only the trailing dirty page(s), so the
    // TOTAL fitOnePage count over N appends is ~O(N) (a small constant each).
    const i500 = appendBuild(500, true);
    const i1000 = appendBuild(1000, true);
    const i2000 = appendBuild(2000, true);

    // From-scratch — each append re-fits every page (~i/3 calls at append i), so
    // the TOTAL is ~O(N²): ~N²/6 calls.
    const s500 = appendBuild(500, false);
    const s1000 = appendBuild(1000, false);

        log(
      `[fitOnePage totals] incremental: 500=${i500.fitCalls} 1000=${i1000.fitCalls} 2000=${i2000.fitCalls} | ` +
        `from-scratch: 500=${s500.fitCalls} 1000=${s1000.fitCalls}`,
    );

    // Incremental TOTAL fitOnePage calls are bounded by a small constant per
    // append — well under 4×N (linear), and ~doubling when N doubles.
    expect(i500.fitCalls).toBeLessThan(500 * 4);
    expect(i1000.fitCalls).toBeLessThan(1000 * 4);
    expect(i2000.fitCalls).toBeLessThan(2000 * 4);
    // Linear: doubling N roughly doubles the count (< 3x, well under quadratic).
    expect(i1000.fitCalls).toBeLessThan(i500.fitCalls * 3);
    expect(i2000.fitCalls).toBeLessThan(i1000.fitCalls * 3);

    // From-scratch is QUADRATIC: its total dwarfs the incremental total at the
    // same N, and doubling N MORE-than-doubles it (the O(N²) signature). At
    // N=1000 the from-scratch path makes ~167k fitOnePage calls vs the
    // incremental path's ~1.3k — the freeze this fix removes.
    expect(s500.fitCalls).toBeGreaterThan(i500.fitCalls * 10);
    expect(s1000.fitCalls).toBeGreaterThan(s500.fitCalls * 3);

    // Surface ms for the report (not asserted — wall-clock is noisy and single-
    // line paragraphs make each fitOnePage call cheap; the call COUNT above is
    // the robust asymptotic signal).
        log(
      `[build-scaling ms @ N=2000] incremental≈${i2000.ms.toFixed(1)}ms (metas+measurePass)`,
    );
    // Explicit timeout: this test intentionally does heavy O(N²) from-scratch
    // work at N=1000 (~167k fitOnePage calls) as the quadratic baseline, which
    // can get CPU-starved under the parallel full-suite run. Give it headroom
    // so it doesn't flake on load (it runs ~1.2s in isolation).
  }, 30_000);
});
