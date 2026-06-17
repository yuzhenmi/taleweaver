/**
 * Regression for the bidi Shift+Arrow visual-selection oscillation (#503): an RTL
 * Hebrew run embedded in an LTR paragraph ("ab זאב cd"). Pressing Shift+ArrowLeft
 * through the RTL run must GROW the highlighted region monotonically in VISUAL
 * order — never collapse to empty mid-word. Pre-fix (logical-range highlight) the
 * covered extent was `[min(offsetStart,offsetEnd), max(...))` which is EMPTY at
 * press 4 (focus logical offset returns to 3, the anchor's offset → `[3,3)`),
 * so the whole-word highlight vanished and reappeared.
 *
 * The fix (slice 5) reads `EditorState.anchorAffinity` / `caretAffinity` to render
 * the VISUAL extent between the anchor's and the focus's resolved visual coords —
 * a single contiguous interval that only grows. This test drives the REAL nav
 * intents end-to-end and derives the covered x-extent via `computeSelectionRects`,
 * the user's exact path.
 *
 * Slice 4 already seeds/persists `anchorAffinity`; slice 5 makes the geometry
 * read it. The transparency test pins that a PURE-LTR selection (no affinity →
 * undefined → logical path) is byte-identical to the four-arg logical output.
 *
 * Migrated from `packages/core/src/editor/actions/bidi-visual-selection-extent.test.ts`
 * (Phase 0b: EXPAND_SELECTION / EXPAND_LINE / EXPAND_LINE_BOUNDARY left core's
 * reducer for the print backend's `resolveNavIntent`). Assertions byte-identical;
 * the layout config (page geometry) now lives on the driver via `makeNavEditor`'s
 * `pageConfig` option, and the positioned tree is materialized from the driver
 * layout exactly as the controller does.
 */
import { describe, it, expect } from "vitest";
import { createMockShaper, getBlock, INITIAL_COMPUTED_STYLE, adaptShaperToMeasurer, type TextMeasurer, type BlockId, type PageConfig } from "@taleweaver/core";
import { computeSelectionRects, computeUsedStyle, createBlockBox, getLineIndex, buildLineBidiView, inlineCoordForOffset, type LayoutBox, type VirtualLayoutTree, type SelectionRect } from "../index";
import {
  makeNavEditor,
  typeText,
  caretAt,
  nav,
  layoutOf,
  type NavCtx,
} from "./nav-test-helpers";

function nth<T>(arr: readonly T[], i: number, what = "element"): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected ${what} at index ${i}`);
  return v;
}

/**
 * Materialize the driver layout for `ctx` into one positioned `LayoutBox`: a
 * non-paginated tree is already positioned; a `VirtualLayoutTree`'s pages are
 * assembled into a minimal outer box (each `getPage(i)` is positioned at its
 * document-absolute offset) — the exact selection-rect ground truth the
 * controller reads per-page.
 */
function positionedTree(ctx: NavCtx): LayoutBox {
  const tree = layoutOf(ctx);
  if (tree.type !== "virtual-root") return tree;
  return assembleAllPages(tree);
}

function assembleAllPages(tree: VirtualLayoutTree): LayoutBox {
  const pageCount = tree.plan.entries.length;
  const pages = tree.getPages(0, pageCount - 1);
  const usedStyle = computeUsedStyle(INITIAL_COMPUTED_STYLE, tree.inlineSize, "indefinite");
  return createBlockBox(
    "virtual-root",
    0,
    0,
    tree.inlineSize,
    tree.blockSize,
    INITIAL_COMPUTED_STYLE.writingMode,
    INITIAL_COMPUTED_STYLE.direction,
    INITIAL_COMPUTED_STYLE,
    usedStyle,
    pages,
    tree.inlineSize,
  );
}

function paragraphId(ctx: NavCtx): BlockId {
  const root = getBlock(ctx.editor.state, ctx.editor.state.rootId);
  if (root === null || root.firstChildId === null) throw new Error("test setup");
  return root.firstChildId;
}

/** Force `caretAffinity` onto the context's editor (the prior-action caret side). */
function withCaretAffinity(ctx: NavCtx, affinity: "before" | "after"): NavCtx {
  return { ...ctx, editor: { ...ctx.editor, caretAffinity: affinity } };
}

function expandBack(ctx: NavCtx): NavCtx {
  return nav(ctx, { type: "EXPAND_SELECTION", direction: "backward" });
}
function expandFwd(ctx: NavCtx): NavCtx {
  return nav(ctx, { type: "EXPAND_SELECTION", direction: "forward" });
}

const sharedMeasurer: TextMeasurer = adaptShaperToMeasurer(createMockShaper(8, 16));

/**
 * The covered visual x-extent of the current selection: `[lo, hi]` = the
 * min `rect.x` and max `rect.x + rect.width` across the visual-extent rects,
 * threading the editor's anchor/focus affinities (the user's exact path).
 * Returns `{ lo, hi }`; an empty rect-set is `{ lo: NaN, hi: NaN }`.
 */
function coveredExtent(ctx: NavCtx): { lo: number; hi: number; rects: SelectionRect[] } {
  const positioned = positionedTree(ctx);
  const rects = computeSelectionRects(
    ctx.editor.state,
    ctx.editor.selection,
    positioned,
    sharedMeasurer,
    ctx.editor.anchorAffinity,
    ctx.editor.caretAffinity,
  );
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (const r of rects) {
    if (r.x < lo) lo = r.x;
    if (r.x + r.width > hi) hi = r.x + r.width;
  }
  return rects.length === 0 ? { lo: NaN, hi: NaN, rects } : { lo, hi, rects };
}

describe("EXPAND_SELECTION — visual-extent through an RTL run in LTR text (#503)", () => {
  // "ab זאב cd", 8px/glyph. Logical: a0 b1 sp2 ז3 א4 ב5 sp6 c7 d8.
  // Hebrew run [3,6) RTL. Visual L→R: a[0] b[8] sp[16] ב[24] א[32] ז[40] sp[48] c[56] d[64].
  // Hebrew run's visual extent is [24, 48].

  it("Shift+ArrowLeft from the Hebrew run's right edge grows monotonically — never empty at press 4", () => {
    let ctx = typeText(makeNavEditor(), "ab זאב cd");
    const pid = paragraphId(ctx);
    ctx = caretAt(ctx, pid, 3);
    ctx = withCaretAffinity(ctx, "after");

    const extents: Array<{ lo: number; hi: number }> = [];
    for (let press = 0; press < 7; press++) {
      ctx = expandBack(ctx);
      const { lo, hi } = coveredExtent(ctx);
      extents.push({ lo, hi });
    }

    // Press 4 (index 3) is the fix: the LOGICAL path gives `[3,3)` = EMPTY; the
    // VISUAL-extent path gives the whole Hebrew word `[24,48]`.
    const e3 = nth(extents, 3, "extent");
    expect(e3.hi - e3.lo).toBeGreaterThan(0);

    // By press 3 (index 2) the whole Hebrew run [24,48] is covered.
    const e2 = nth(extents, 2, "extent");
    expect(e2.lo).toBeLessThanOrEqual(24 + 1e-6);
    expect(e2.hi).toBeGreaterThanOrEqual(48 - 1e-6);

    // MONOTONE: each press is a SUPERSET of the previous (lo non-increasing, hi
    // non-decreasing) — the highlight only grows.
    for (let i = 1; i < extents.length; i++) {
      const cur = nth(extents, i, "extent");
      const prev = nth(extents, i - 1, "extent");
      expect(cur.lo).toBeLessThanOrEqual(prev.lo + 1e-6);
      expect(cur.hi).toBeGreaterThanOrEqual(prev.hi - 1e-6);
    }
  });

  it("Shift+ArrowRight from the Hebrew run's left edge grows monotonically — mirror", () => {
    let ctx = typeText(makeNavEditor(), "ab זאב cd");
    const pid = paragraphId(ctx);
    ctx = caretAt(ctx, pid, 6);
    ctx = withCaretAffinity(ctx, "before");

    const extents: Array<{ lo: number; hi: number }> = [];
    for (let press = 0; press < 7; press++) {
      ctx = expandFwd(ctx);
      const { lo, hi } = coveredExtent(ctx);
      extents.push({ lo, hi });
    }

    // No press collapses to empty.
    for (const e of extents) expect(e.hi - e.lo).toBeGreaterThan(0);

    // The whole Hebrew run [24,48] is covered once the focus has crossed it.
    const e2 = nth(extents, 2, "extent");
    expect(e2.lo).toBeLessThanOrEqual(24 + 1e-6);
    expect(e2.hi).toBeGreaterThanOrEqual(48 - 1e-6);

    // MONOTONE growth.
    for (let i = 1; i < extents.length; i++) {
      const cur = nth(extents, i, "extent");
      const prev = nth(extents, i - 1, "extent");
      expect(cur.lo).toBeLessThanOrEqual(prev.lo + 1e-6);
      expect(cur.hi).toBeGreaterThanOrEqual(prev.hi - 1e-6);
    }
  });

  it("pure-LTR EXPAND is byte-identical to the four-arg logical path (transparency)", () => {
    let ctx = typeText(makeNavEditor(), "abc");
    const pid = paragraphId(ctx);
    ctx = caretAt(ctx, pid, 0);

    // EXPAND forward twice → focus at offset 2; anchorAffinity stays undefined
    // (a pure-LTR line never seeds a meaningful affinity), so the geometry takes
    // the LOGICAL path.
    ctx = expandFwd(ctx);
    ctx = expandFwd(ctx);
    expect(ctx.editor.anchorAffinity).toBeUndefined();

    const positioned = positionedTree(ctx);
    // Four-arg (no affinity) logical output.
    const logical = computeSelectionRects(
      ctx.editor.state,
      ctx.editor.selection,
      positioned,
      sharedMeasurer,
    );
    // Six-arg with the editor's (undefined) affinities → must be identical.
    const withAffinity = computeSelectionRects(
      ctx.editor.state,
      ctx.editor.selection,
      positioned,
      sharedMeasurer,
      ctx.editor.anchorAffinity,
      ctx.editor.caretAffinity,
    );
    expect(withAffinity).toEqual(logical);
    expect(logical.length).toBe(1);
    const logical0 = nth(logical, 0, "rect");
    expect(logical0.x).toBe(0);
    expect(logical0.width).toBe(16); // "ab" → 16px
  });
});

describe("computeSelectionRects — multi-line bidi visual-extent first-of-multi branch (F1)", () => {
  // F1 (audit 2026-06-12): the emitLineRect `first-of-multi` partial branch
  // (`isGlobalFirst && !isGlobalLast && startAffinity !== undefined`) had no
  // end-to-end coverage. Build a MULTI-LINE selection whose FIRST line crosses a
  // bidi boundary with a defined anchorAffinity, and assert that line's rect
  // starts at the anchor's VISUAL-EXTENT coord — NOT the line's full inline-start.
  //
  // Fixture "ab זאב cd ef" at a narrow page width wraps to two lines:
  //   line 0 = state offsets [0,10] ("ab זאב cd "), line 1 = [10,12] ("ef").
  // The RTL Hebrew run is [3,6) on line 0. Visual order on line 0 (8px/glyph):
  //   a[0] b[8] sp[16] ב[24] א[32] ז[40] sp[48] c[56] d[64] sp[72].
  // The Hebrew run's visual extent is [24,48]; offset 3 (its logStart) with
  // affinity "after" is the run's visual RIGHT edge (x=48).

  const narrowPage: PageConfig = {
    pageInlineSize: 88,
    pageBlockSize: 2000,
    pageMargins: { blockStart: 0, blockEnd: 0, inlineStart: 0, inlineEnd: 0 },
    pageGap: 0,
  };

  function narrowCtx(): NavCtx {
    return makeNavEditor({ pageConfig: narrowPage, containerWidth: 800 });
  }

  it("first line of a down-extended selection starts at the anchor's visual coord at a bidi boundary, not the line inline-start", () => {
    let ctx = typeText(narrowCtx(), "ab זאב cd ef");
    const pid = paragraphId(ctx);

    // Confirm the fixture wrapped to >= 2 lines with the bidi boundary on line 0.
    const positioned = positionedTree(ctx);
    const lines = getLineIndex(positioned).byBlock.get(pid) ?? [];
    expect(lines.length).toBeGreaterThanOrEqual(2);
    const line0 = nth(lines, 0, "line");
    // The anchor offset (3, the LTR→RTL boundary) must sit on line 0.
    expect(line0.line.inlineOffsetStart).toBeLessThanOrEqual(3);
    expect(line0.line.inlineOffsetEnd).toBeGreaterThan(3);

    // Caret at offset 3 (the boundary, start of the Hebrew run) with "after"
    // affinity → the caret hugs the RTL run.
    ctx = caretAt(ctx, pid, 3);
    ctx = withCaretAffinity(ctx, "after");

    // EXPAND_SELECTION forward once: seeds anchorAffinity from caretAffinity
    // ("after") on the collapse→extend transition; the anchor stays at offset 3.
    ctx = nav(ctx, { type: "EXPAND_SELECTION", direction: "forward" });
    expect(ctx.editor.anchorAffinity).toBe("after");

    // EXPAND_LINE down: move the FOCUS to line 1; anchorAffinity persists (the
    // resolver manages the anchor-affinity field).
    ctx = nav(ctx, { type: "EXPAND_LINE", direction: "down" });
    expect(ctx.editor.anchorAffinity).toBe("after");
    // Anchor unchanged on line 0 at the boundary; focus advanced to line 1.
    expect(ctx.editor.selection.anchor.offset).toBe(3);
    expect(ctx.editor.selection.focus.offset).toBeGreaterThanOrEqual(line0.line.inlineOffsetEnd);

    // The anchor's resolved VISUAL coord on line 0 at (offset 3, "after") — the
    // value the first-of-multi branch must use for the rect's inline-start.
    const view = buildLineBidiView(line0);
    const anchorVisualX = inlineCoordForOffset(view, 3, "after", sharedMeasurer);
    // Sanity: the boundary coord is the Hebrew run's visual RIGHT edge, well past
    // the line inline-start — so "uses the anchor coord" ≠ "uses 0".
    expect(anchorVisualX).toBeGreaterThan(40);

    const rects = computeSelectionRects(
      ctx.editor.state,
      ctx.editor.selection,
      positioned,
      sharedMeasurer,
      ctx.editor.anchorAffinity,
      ctx.editor.caretAffinity,
    );

    // The line-0 rect is the one on the first line's block band (smallest y).
    const minY = Math.min(...rects.map((r) => r.y));
    const line0Rects = rects.filter((r) => r.y === minY);
    expect(line0Rects.length).toBeGreaterThan(0);
    const line0Lo = Math.min(...line0Rects.map((r) => r.x));

    // THE ASSERTION: line 0 (isGlobalFirst, not last) starts at the anchor's
    // visual-extent coord — NOT the line's full inline-start (0). Without the
    // first-of-multi visual-extent branch this would be the line inline-lo.
    expect(line0Lo).toBeCloseTo(anchorVisualX, 6);
    expect(line0Lo).toBeGreaterThan(0);
  });

  // CUR-2 (audit 2026-06-12): EXPAND_LINE / EXPAND_LINE_BOUNDARY must SEED
  // `anchorAffinity` from `caretAffinity` on the collapse→extend transition (the
  // shared `seedAnchorAffinity` rule), not merely PERSIST it. The F1 test above
  // masks this gap because it starts the selection with EXPAND_SELECTION FIRST
  // (which already seeded the anchor) and only then presses EXPAND_LINE. These
  // tests start the selection with EXPAND_LINE / EXPAND_LINE_BOUNDARY FIRST, so
  // the seed has to fire on THAT action.
  //
  // The engine-level contract is "the affinity is SEEDED"; the RTL-visual
  // end-to-end rendering it feeds is browser-gated (#474 B2 / #503, the user's
  // domain) — these tests assert the affinity, which is what the engine owns.

  it("EXPAND_LINE down seeds anchorAffinity from caretAffinity on the collapse→extend transition", () => {
    let ctx = typeText(narrowCtx(), "ab זאב cd ef");
    const pid = paragraphId(ctx);

    // Collapsed caret at the LTR→RTL boundary (offset 3) on line 0, with a
    // DEFINED caretAffinity ("after" — the caret hugs the RTL run). No prior
    // EXPAND_SELECTION, so `anchorAffinity` is undefined going in.
    ctx = caretAt(ctx, pid, 3);
    ctx = withCaretAffinity(ctx, "after");
    expect(ctx.editor.anchorAffinity).toBeUndefined();

    // START the selection with EXPAND_LINE down (the EXPAND_LINE-first ordering
    // the F1 test masks). The seed must fire HERE.
    ctx = nav(ctx, { type: "EXPAND_LINE", direction: "down" });

    // SEEDED — equals the prior caretAffinity, NOT undefined (the pre-fix value).
    expect(ctx.editor.anchorAffinity).toBe("after");
    // The anchor stayed at the boundary; the focus moved down a line.
    expect(ctx.editor.selection.anchor.offset).toBe(3);
  });

  it("EXPAND_LINE_BOUNDARY (Shift+End) seeds anchorAffinity from caretAffinity on the collapse→extend transition", () => {
    let ctx = typeText(narrowCtx(), "ab זאב cd ef");
    const pid = paragraphId(ctx);

    // Collapsed caret at the boundary (offset 3) with a defined caretAffinity.
    ctx = caretAt(ctx, pid, 3);
    ctx = withCaretAffinity(ctx, "after");
    expect(ctx.editor.anchorAffinity).toBeUndefined();

    // START the selection with Shift+End (EXPAND_LINE_BOUNDARY) — the seed fires
    // here, then the resolver overwrites caretAffinity to "before" (End's edge).
    ctx = nav(ctx, { type: "EXPAND_LINE_BOUNDARY", boundary: "end" });

    // SEEDED from the caret's pre-action side ("after"), NOT undefined.
    expect(ctx.editor.anchorAffinity).toBe("after");
    expect(ctx.editor.selection.anchor.offset).toBe(3);
  });
});
