import { positionsEqual, spanStart, spanEnd, selectionContextOf, comparePositions } from "@taleweaver/core";
import type { State, Span, BlockId, BlockKindResolver } from "@taleweaver/core";
import type { LayoutBox } from "../layout/layout-node";
import { getAtomicBoxIndex } from "./atomic-box-index";
import type { TextShaper } from "@taleweaver/core";
import type { TextMeasurer } from "@taleweaver/core";
import { isTextShaper, adaptShaperToMeasurer } from "@taleweaver/core";
import type { ComputedStyle } from "@taleweaver/core";
import { resolvePixelPosition, type PixelPosition } from "./cursor-position";
import {
  collectLineLeaves,
  coordOf,
  sizeAlong,
  lineCoordOf,
  lineSizeAlong,
  findLineForPosition,
  getLineIndex,
  makeContextFilter,
  type AbsoluteLineBox,
} from "./line-flatten";
import { buildLineBidiView, selectionRectsForLineRange, inlineCoordForOffset } from "./line-bidi";
import type { CaretAffinity } from "./line-bidi";
import { axisMapFor, type AxisMap } from "@taleweaver/core";
import { markStart, markEnd } from "@taleweaver/core";

/**
 * Visual highlight rectangle for a span of selected content. Coords
 * are page-relative (descendants of PageBox use the page's coordinate
 * frame; otherwise document-relative).
 */
export interface SelectionRect {
  x: number;
  y: number;
  width: number;
  height: number;
  pageIndex: number;
}

/**
 * Tolerance (px) for treating a content segment's right edge as coincident with
 * the line's right edge when fusing the paragraph-break indicator onto it.
 */
const INDICATOR_EPSILON = 1e-6;

/**
 * Do two endpoint affinities make a same-offset span VISUALLY non-empty? At a
 * bidi direction boundary one logical offset has two visual positions, so a
 * logically-collapsed span (equal positions) is the visual dual-caret case when
 * BOTH affinities are defined AND differ (#503). Returns `false` whenever either
 * is `undefined` (every affinity-less caller) → the byte-identical early return.
 */
function affinitiesDiffer(
  a: CaretAffinity | undefined,
  b: CaretAffinity | undefined,
): boolean {
  return a !== undefined && b !== undefined && a !== b;
}

/**
 * Compute visual highlight rectangles for a selection span.
 *
 * Zero-width rects are filtered out. Collapsed spans (anchor === focus)
 * return an empty array — callers that need a 1px caret rect should
 * synthesize it from `resolvePixelPosition(focus)`.
 *
 * Algorithm (LineBox-canonical; see
 * `docs/superpowers/specs/2026-05-23-linebox-canonical-anchor-design.md`):
 *   1. Normalize the span to (start, end) in document order.
 *   2. Resolve start and end to PixelPositions (for their X coords).
 *   3. Find the `AbsoluteLineBox` containing each via
 *      `findLineForPosition`.
 *   4. Iterate `allLines[startLineIdx..endLineIdx]`. For each line,
 *      emit one rect:
 *      - same-line span: x=startX, width=endX-startX.
 *      - first line of multi-line span: x=startX, width=
 *        lineRightEdge + boundaryIndicator - startX.
 *      - last line of multi-line span: x=lineLeftEdge, width=
 *        endX - lineLeftEdge.
 *      - middle line: full line content (+ boundary indicator).
 *   5. `line.isBlockBoundaryLine` drives the paragraph-break
 *      indicator after a line (replaces the prior
 *      `collectBlockBoundaryLines` traversal).
 */
export function computeSelectionRects(
  state: State,
  span: Span,
  layoutTree: LayoutBox,
  shaperOrMeasurer: TextShaper | TextMeasurer,
  anchorAffinity?: CaretAffinity,
  focusAffinity?: CaretAffinity,
): SelectionRect[] {
  const t = markStart("cursor.selection-geometry");
  try {
    // #503: a logically-collapsed span (same offset) is VISUALLY non-empty when
    // the anchor and focus sit on OPPOSITE sides of a bidi direction boundary —
    // same offset, but DIFFERENT affinities (the dual-caret case). There the
    // highlight spans the two visual coords (e.g. press 4 of Shift+Arrow through
    // an RTL run). Only short-circuit when the span is BOTH logically AND
    // visually collapsed (equal positions and no differing affinity). Every 4-arg
    // caller passes no affinity → `affinitiesDiffer` is false → byte-identical.
    if (positionsEqual(span.anchor, span.focus) && !affinitiesDiffer(anchorAffinity, focusAffinity)) {
      return [];
    }

    const measurer: TextMeasurer = isTextShaper(shaperOrMeasurer)
      ? adaptShaperToMeasurer(shaperOrMeasurer)
      : shaperOrMeasurer;

    const start = spanStart(state, span);
    const end = spanEnd(state, span);

    // #503 visual-extent: map anchor/focus affinities to DOCUMENT order. The
    // start is the document-earlier endpoint; if the anchor is at-or-before the
    // focus it owns the start side (`<=0` → collapsed/same-offset returns 0 →
    // anchorIsStart = true). A `comparePositions` boolean (not `===` reference
    // identity) is robust against a caller passing a reconstructed Span.
    const anchorIsStart = comparePositions(state, span.anchor, span.focus) <= 0;
    const startAffinity = anchorIsStart ? anchorAffinity : focusAffinity;
    const endAffinity = anchorIsStart ? focusAffinity : anchorAffinity;

    const startPos = resolvePixelPosition(state, start, layoutTree, measurer);
    const endPos = resolvePixelPosition(state, end, layoutTree, measurer);
    if (startPos === null || endPos === null) return [];

    // L-PERF-D: shared with cursor-position + line-navigation via the
    // WeakMap-cached LineIndex; only the first consumer per layout
    // cycle pays the collectLineBoxes walk.
    //
    // Context isolation (#327 companion): C.2c T6 made `.all` include the
    // header/footer SLOT lines, so for a body span (start→end across pages) the
    // index range would otherwise enclose the interleaved slot lines between
    // pages. Filter candidate lines to the SELECTION's context (anchor and focus
    // share a context — cross-context spans are unsupported) so a body span emits
    // no header/footer rects and a header/footer span emits no body rects. A
    // main-only doc shares one context → the filter returns the array unchanged
    // (byte-identical, allocation-free).
    const filter = makeContextFilter(state, selectionContextOf(state, start.blockId));
    const allLines = filter(getLineIndex(layoutTree).all);
    if (allLines.length === 0) return [];

    const startLineIdx = findLineForPosition(allLines, start);
    const endLineIdx = findLineForPosition(allLines, end);
    if (startLineIdx < 0 || endLineIdx < 0) return [];

    const rects: SelectionRect[] = [];

    for (let i = startLineIdx; i <= endLineIdx; i++) {
      const al = allLines[i];
      if (al === undefined) {
        throw new Error(`selection-geometry: allLines[${i}] missing (unreachable)`);
      }
      const lineRects = emitLineRect(
        al,
        i === startLineIdx,
        i === endLineIdx,
        start.offset,
        end.offset,
        measurer,
        startAffinity,
        endAffinity,
      );
      for (const r of lineRects) rects.push(r);
    }

    return rects;
  } finally {
    markEnd("cursor.selection-geometry", t);
  }
}

/**
 * Per-page selection rects: emit the rects for the lines of ONE page that fall
 * within `span`, given the span's already-resolved start/end pixel positions
 * (resolved ONCE by the caller, against the virtual tree). The union over all
 * pages equals `computeSelectionRects` over the materialized tree — for
 * NON-spanning boundary blocks. A boundary block that spans a page break is NOT
 * this function's domain on its own (a per-page lookup can't see the boundary's
 * other-page fragment); the caller detects that case and routes it to the
 * controller's `selectionRectsAcrossPages`, which calls THIS function once per
 * spanned page and concatenates the results (per-page, never the whole tree).
 */
export function computeSelectionRectsForPage(
  state: State,
  span: Span,
  pageBox: LayoutBox,
  pageIndex: number,
  startPos: PixelPosition,
  endPos: PixelPosition,
  shaperOrMeasurer: TextShaper | TextMeasurer,
  anchorAffinity?: CaretAffinity,
  focusAffinity?: CaretAffinity,
): SelectionRect[] {
  const t = markStart("cursor.selection-geometry");
  try {
    // #503 (see `computeSelectionRects`): a logically-collapsed span is VISUALLY
    // non-empty at a bidi boundary when the affinities differ (the dual-caret
    // case). Only short-circuit when BOTH logically and visually collapsed. Every
    // affinity-less caller keeps the byte-identical early return.
    if (positionsEqual(span.anchor, span.focus) && !affinitiesDiffer(anchorAffinity, focusAffinity)) {
      return [];
    }
    const startPage = startPos.pageIndex;
    const endPage = endPos.pageIndex;
    if (pageIndex < startPage || pageIndex > endPage) return [];

    const measurer: TextMeasurer = isTextShaper(shaperOrMeasurer)
      ? adaptShaperToMeasurer(shaperOrMeasurer)
      : shaperOrMeasurer;

    const start = spanStart(state, span);
    const end = spanEnd(state, span);

    // #503 visual-extent: map anchor/focus affinities to DOCUMENT order (see
    // `computeSelectionRects` for the rationale on the `comparePositions` boolean).
    const anchorIsStart = comparePositions(state, span.anchor, span.focus) <= 0;
    const startAffinity = anchorIsStart ? anchorAffinity : focusAffinity;
    const endAffinity = anchorIsStart ? focusAffinity : anchorAffinity;

    // Context isolation (#327 companion): on a page carrying both body and
    // header/footer slot lines, the per-page index interleaves them ([header,
    // body, footer]). Filter to the SELECTION's context so a body span's lo..hi
    // range can't include this page's slot lines (and vice-versa). Single-context
    // page → array returned unchanged (byte-identical, allocation-free).
    const filter = makeContextFilter(state, selectionContextOf(state, start.blockId));
    const pageLines = filter(getLineIndex(pageBox).all);
    if (pageLines.length === 0) return [];

    // Lines on this page within the selection. On the start page the range
    // begins at the start line; on the end page it ends at the end line; on a
    // fully-enclosed middle page every line is selected.
    const lo = pageIndex === startPage ? findLineForPosition(pageLines, start) : 0;
    const hi = pageIndex === endPage ? findLineForPosition(pageLines, end) : pageLines.length - 1;
    if (lo < 0 || hi < 0) return [];

    const rects: SelectionRect[] = [];
    for (let i = lo; i <= hi; i++) {
      const pl = pageLines[i];
      if (pl === undefined) {
        throw new Error(`selection-geometry: pageLines[${i}] missing (unreachable)`);
      }
      const lineRects = emitLineRect(
        pl,
        pageIndex === startPage && i === lo,
        pageIndex === endPage && i === hi,
        start.offset,
        end.offset,
        measurer,
        startAffinity,
        endAffinity,
      );
      for (const r of lineRects) rects.push(r);
    }
    return rects;
  } finally {
    markEnd("cursor.selection-geometry", t);
  }
}

/**
 * Project an INLINE interval (`[inlineLo, inlineHi]` along the inline axis) plus
 * a BLOCK band (`blockLo`, extent `blockSize` along the block axis) into a TRUE
 * PHYSICAL `SelectionRect`-shaped `{x, y, width, height}` via the line's axis
 * map (I5). `SelectionRect` feeds paint directly, so unlike `PixelPosition`
 * (which stays inline/block until P3.8) it must be physical here.
 *
 * The inline span lands on the `am.inline` physical axis (x+width if
 * `am.inline === "x"`, else y+height); the block band lands on the `am.block`
 * physical axis. For `horizontal-tb` (`inline→x`, `block→y`) this is identity:
 * `{x: inlineLo, width: inlineHi − inlineLo, y: blockLo, height: blockSize}`
 * — byte-identical to the legacy hard-coded shape.
 */
function physicalRectFromAxes(
  am: AxisMap,
  inlineLo: number,
  inlineHi: number,
  blockLo: number,
  blockSize: number,
  pageIndex: number,
): SelectionRect {
  const inlineExtent = inlineHi - inlineLo;
  if (am.inline === "x") {
    // inline→x, block→y (horizontal-tb).
    return { x: inlineLo, y: blockLo, width: inlineExtent, height: blockSize, pageIndex };
  }
  // inline→y, block→x (vertical modes).
  return { x: blockLo, y: inlineLo, width: blockSize, height: inlineExtent, pageIndex };
}

/**
 * Emit the highlight rect(s) for one line of a selection. `isGlobalFirst` /
 * `isGlobalLast` are relative to the WHOLE selection (across pages), not just
 * this page — so a line on a fully-enclosed middle page is neither, getting a
 * full-width rect. Returns an EMPTY array when the line contributes nothing.
 *
 * Bidi-aware (P4-C.2 §F): the partial branches (same-line, first-line,
 * last-line) segment the line-local logical range into its VISUAL intervals via
 * `selectionRectsForLineRange`, so a range crossing a direction boundary draws
 * >= 2 disjoint rects (never the old single `endX - startX` strip, which could
 * go NEGATIVE on a reordered line). The middle-full-line branch keeps
 * `computeLineEdges` (already direction-safe: a min/max over all leaf
 * positions). The paragraph-break indicator (after a block-boundary line) is a
 * separate small rect at the line's inline end, appended to first/middle lines.
 *
 * Writing-mode-aware (P3.5c §I5): all geometry below is computed in INLINE/BLOCK
 * terms (the selected inline span + the line's block band) and projected to a
 * TRUE PHYSICAL `SelectionRect` via `physicalRectFromAxes` at the LAST step. The
 * `VisualInterval {xLo,xHi}` from `selectionRectsForLineRange` are INLINE-axis
 * intervals (P3.5a) — they are projected HERE, never re-projected in line-bidi.
 * The paragraph-break indicator is an INLINE advance, folded into the inline
 * span BEFORE projection. For h-tb the projection is identity (byte-identical).
 */
function emitLineRect(
  al: AbsoluteLineBox,
  isGlobalFirst: boolean,
  isGlobalLast: boolean,
  selectionStartOffset: number,
  selectionEndOffset: number,
  measurer: TextMeasurer,
  startAffinity?: CaretAffinity,
  endAffinity?: CaretAffinity,
): SelectionRect[] {
  const line = al.line;
  const am = axisMapFor(line.writingMode, line.computedStyle.direction);
  const { inlineLo: lineInlineLo, inlineHi: lineInlineHi, trailingStyle } =
    computeLineEdges(al, am);
  const indicatorW = line.isBlockBoundaryLine
    ? measurer.measureWidth("  ", trailingStyle)
    : 0;

  // The line's block band — shared by every rect emitted for this line. Both
  // are physical coords (start coords are pre-physicalized; the extent projects
  // the logical block-size to its physical axis).
  const blockLo = lineCoordOf(al, am.block);
  const blockSize = lineSizeAlong(al, am.block);

  const out: SelectionRect[] = [];
  const push = (inlineLo: number, inlineHi: number): void => {
    if (inlineHi - inlineLo <= 0) return;
    out.push(physicalRectFromAxes(am, inlineLo, inlineHi, blockLo, blockSize, al.pageIndex));
  };

  if (!isGlobalFirst && !isGlobalLast) {
    // Middle full line: the whole line's content (direction-safe via the
    // min/max over leaf positions), plus the paragraph-break indicator (an
    // inline advance past the line's inline end).
    push(lineInlineLo, lineInlineHi + indicatorW);
    return out;
  }

  // Partial line — segment the line-local logical range into VISUAL intervals.
  // first line: from the selection's start offset to the line end;
  // last line:  from the line start to the selection's end offset;
  // same-line:  from the selection's start to its end offset.
  // All clipped into this line's own [inlineOffsetStart, inlineOffsetEnd].
  const rangeStart = isGlobalFirst
    ? Math.max(selectionStartOffset, line.inlineOffsetStart)
    : line.inlineOffsetStart;
  const rangeEnd = isGlobalLast
    ? Math.min(selectionEndOffset, line.inlineOffsetEnd)
    : line.inlineOffsetEnd;

  const view = buildLineBidiView(al);
  if (view.isEmpty) {
    // Strut-only line (empty paragraph). No caret-target leaves, so the
    // segmentation yields nothing — fall back to the line's content edges (for
    // an empty line both collapse to the line inline-start) plus the
    // paragraph-break indicator. This keeps the empty-paragraph narrow indicator
    // (#169/#201). Only the first/middle lines carry the trailing indicator (an
    // empty LAST line contributes only its collapsed content edge, i.e. nothing
    // visible).
    if (isGlobalFirst) {
      push(lineInlineLo, lineInlineHi + indicatorW);
    } else {
      push(lineInlineLo, lineInlineHi);
    }
    return out;
  }

  // #503 VISUAL-EXTENT path. When the keyboard supplied a bidi-boundary affinity
  // for this line's active endpoint(s), draw the SINGLE contiguous inline interval
  // between the anchor's and focus's RESOLVED VISUAL coords — so each Shift+Arrow
  // press grows the highlight monotonically instead of the logical-range path's
  // transient-empty collapse at a direction boundary. Per-branch guards (NOT a
  // single both-defined guard): a multi-line selection that crossed a line via
  // `logicalExtend` clears the FOCUS-side affinity while the ANCHOR-side persists,
  // so the partial first/last lines each need only their own endpoint's affinity.
  // `rangeStart`/`rangeEnd` are this line's already-clipped endpoints (so a coord
  // is never computed for an offset off this line). When no per-branch guard fires
  // (no relevant affinity for this line's active endpoint), fall through to the
  // existing logical path below (mouse-drag, EXPAND_WORD, comment/find consumers,
  // the focus line at a clean line-start after a cross, middle full lines).
  if (isGlobalFirst && isGlobalLast && startAffinity !== undefined && endAffinity !== undefined) {
    // Same-line selection: both endpoints land on this line. No paragraph-break
    // indicator (same-line is the global-last line — matches the logical path).
    const sx = inlineCoordForOffset(view, rangeStart, startAffinity, measurer);
    const ex = inlineCoordForOffset(view, rangeEnd, endAffinity, measurer);
    push(Math.min(sx, ex), Math.max(sx, ex));
    return out;
  }
  if (isGlobalFirst && !isGlobalLast && startAffinity !== undefined) {
    // First line of a multi-line selection: from the anchor's resolved visual
    // coord to the line's inline end (+ the paragraph-break indicator).
    push(inlineCoordForOffset(view, rangeStart, startAffinity, measurer), lineInlineHi + indicatorW);
    return out;
  }
  if (isGlobalLast && !isGlobalFirst && endAffinity !== undefined) {
    // Last line of a multi-line selection: from the line's inline start to the
    // focus's resolved visual coord. No trailing indicator (this is the last line).
    push(lineInlineLo, inlineCoordForOffset(view, rangeEnd, endAffinity, measurer));
    return out;
  }

  const segments = selectionRectsForLineRange(view, rangeStart, rangeEnd, measurer);

  // The paragraph-break indicator trails a block-boundary line whenever the
  // selection continues past it (i.e. this is NOT the global-last line). It sits
  // at the line's inline end (`[lineInlineHi, lineInlineHi + indicatorW]`), past
  // the logical line end — so it is bidi-agnostic. When a content segment
  // already ends AT `lineInlineHi` (the LTR case: the trailing run reaches the
  // line's inline end), the indicator is FUSED onto that segment so a pure-LTR
  // line stays a SINGLE rect (byte-identical to the legacy merged strip). When
  // no segment reaches `lineInlineHi` (e.g. an RTL trailing run, or no content
  // at all) the indicator is emitted as its own rect at the inline end. All of
  // this is in INLINE space; the `push` projection maps it to physical.
  const indicatorActive = !isGlobalLast && indicatorW > 0;
  let indicatorFused = false;
  if (indicatorActive) {
    for (const seg of segments) {
      if (Math.abs(seg.xHi - lineInlineHi) <= INDICATOR_EPSILON) {
        seg.xHi = lineInlineHi + indicatorW;
        indicatorFused = true;
        break;
      }
    }
  }

  for (const seg of segments) {
    push(seg.xLo, seg.xHi);
  }
  if (indicatorActive && !indicatorFused) {
    push(lineInlineHi, lineInlineHi + indicatorW);
  }

  return out;
}

/**
 * Compute the INLINE-axis extent of a line's content. For lines with at least
 * one leaf (text-run or inline-block), returns the lowest leaf inline-start and
 * the highest leaf inline-end (a min/max over leaf positions along the inline
 * axis — direction-safe). For empty (strut) lines, both edges collapse to the
 * line's own inline-start coord — no visible content to highlight.
 *
 * The fold is along `am.inline` (the line's own axis map): for h-tb that is
 * physical X (`coordOf(leaf, "x")` = `absoluteX`, `sizeAlong(leaf, "x")` =
 * `width`), so this is byte-identical to the legacy X-fold; for vertical modes
 * it folds along physical Y. The caller projects the returned inline interval to
 * physical via `physicalRectFromAxes`.
 *
 * Also returns the trailing leaf's computed style for paragraph-break indicator
 * measurement; falls back to the LineBox's own computedStyle for empty lines.
 */
function computeLineEdges(
  al: AbsoluteLineBox,
  am: AxisMap,
): {
  inlineLo: number;
  inlineHi: number;
  trailingStyle: ComputedStyle;
} {
  const leaves = collectLineLeaves(al.line, al.absoluteX, al.absoluteY);
  if (leaves.length === 0) {
    // Empty (strut) line — both edges collapse to the line's inline-start coord.
    // Trailing style falls back to the LineBox's own computedStyle (the IFC
    // stamps it from the source block's parentCs at strut creation), so
    // paragraph-break indicators on empty paragraphs are measured against the
    // block's text style.
    const lineInline = lineCoordOf(al, am.inline);
    return {
      inlineLo: lineInline,
      inlineHi: lineInline,
      trailingStyle: al.line.computedStyle,
    };
  }
  const firstLeaf = leaves[0];
  if (firstLeaf === undefined) {
    throw new Error("selection-geometry: leaves[0] missing (unreachable — length checked)");
  }
  let minInline = coordOf(firstLeaf, am.inline);
  let maxInline = minInline + sizeAlong(firstLeaf, am.inline);
  for (const leaf of leaves) {
    const lo = coordOf(leaf, am.inline);
    if (lo < minInline) minInline = lo;
    const hi = lo + sizeAlong(leaf, am.inline);
    if (hi > maxInline) maxInline = hi;
  }
  const lastLeaf = leaves[leaves.length - 1];
  if (lastLeaf === undefined) {
    throw new Error("selection-geometry: last leaf missing (unreachable — length checked)");
  }
  const trailing = lastLeaf.computedStyle;
  return { inlineLo: minInline, inlineHi: maxInline, trailingStyle: trailing };
}

/**
 * Object-selection geometry (#525). Return the `SelectionRect` (absolute physical
 * bbox + page) for an atomic-leaf block — the rect the host paints as the "this
 * image is selected" outline.
 *
 * Object selections are collapsed-on-atomic (anchor === focus on `{imageId, 0}`),
 * so `computeSelectionRects` early-returns `[]` for them — it serves logical
 * text spans, not atomic objects. This function reads the atomic-leaf geometry
 * the LineBox-canonical selection path can't see (an atomic leaf produces no
 * `LineBox`), via the per-page WeakMap-cached `getAtomicBoxIndex`.
 *
 * Returns `null` when `blockId` is not an atomic-leaf block present in this
 * page's layout (a non-atomic block, or a block absent from the page entirely).
 * The returned rect's coordinate frame matches the index's: page-relative for a
 * per-page `getPage(i)` `PageBox`.
 */
export function computeObjectSelectionRect(
  state: State,
  blockId: BlockId,
  layoutTree: LayoutBox,
  resolver: BlockKindResolver,
): SelectionRect | null {
  const rect = getAtomicBoxIndex(layoutTree, resolver, state).get(blockId);
  if (rect === undefined) return null;
  // `AbsoluteRect` and `SelectionRect` are structurally identical, but the index
  // value is `readonly`; construct a fresh mutable `SelectionRect` (cast-free).
  return {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    pageIndex: rect.pageIndex,
  };
}

// Re-export for tests' convenience.
export type { PixelPosition };
