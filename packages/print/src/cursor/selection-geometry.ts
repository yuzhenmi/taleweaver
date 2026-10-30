import { positionsEqual, spanStart, spanEnd, selectionContextOf, comparePositions, createPosition, clipSpanToText, resolveBlock, ancestorChain } from "@taleweaver/core";
import type { State, Span, Position, BlockId, BlockKindResolver } from "@taleweaver/core";
import type { LayoutBox } from "../layout/layout-node";
import type { VirtualLayoutTree } from "../layout/virtual-layout-tree";
import { getAtomicBoxIndex, getObjectBoxes } from "./atomic-box-index";
import { getBoundaryMarksByBlock } from "./boundary-mark-index";
import { clipInFrame } from "./ancestor-clip";
import type { TextShaper } from "@taleweaver/core";
import type { TextMeasurer } from "@taleweaver/core";
import { isTextShaper, adaptShaperToMeasurer } from "@taleweaver/core";
import type { ComputedStyle } from "@taleweaver/core";
import { resolvePixelPosition, resolvePositionInOwnLines, type PixelPosition } from "./cursor-position";
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
 * Tolerance (px) for treating a content segment's edge as touching the ¶ extension
 * when fusing the extension onto it.
 */
const INDICATOR_EPSILON = 1e-6;

/** An interval along a line's inline axis (physical coordinates). */
interface InlineInterval {
  readonly lo: number;
  readonly hi: number;
}

/**
 * The inline-axis extent of the end-mark ¶ glyph drawn after `al` (its block's last
 * line), or `undefined` when none is placed there. Same frame as the line index.
 */
function endMarkInterval(tree: LayoutBox, al: AbsoluteLineBox): InlineInterval | undefined {
  if (!al.line.isBlockBoundaryLine) return undefined;
  const m = getBoundaryMarksByBlock(tree)
    .get(al.line.ownerBlockId)
    ?.find((r) => r.pageIndex === al.pageIndex);
  if (m === undefined) return undefined;
  return axisMapFor(al.line.writingMode, al.line.computedStyle.direction).inline === "x"
    ? { lo: m.x, hi: m.x + m.width }
    : { lo: m.y, hi: m.y + m.height };
}

/**
 * Do two endpoint affinities make a same-offset span VISUALLY non-empty? At a
 * bidi direction boundary one logical offset has two visual positions, so a
 * logically-collapsed span (equal positions) is the visual dual-caret case when
 * BOTH affinities are defined AND differ. Returns `false` whenever either
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
 * Algorithm (LineBox-canonical):
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
 *
 * OBJECT blocks (`isObjectBlock`: image, rule, table of contents, table) are
 * covered whole or not at all: the lines above are the span's TEXT part (an
 * object endpoint clipped off via `clipSpanToText`, a covered table's own lines
 * left out), and each covered object adds its box (see `coveredObjectRects`).
 * A span inside one text block is unaffected.
 */
export function computeSelectionRects(
  state: State,
  span: Span,
  layoutTree: LayoutBox,
  shaperOrMeasurer: TextShaper | TextMeasurer,
  anchorAffinity?: CaretAffinity,
  focusAffinity?: CaretAffinity,
): SelectionRect[] {
  if (positionsEqual(span.anchor, span.focus) && !affinitiesDiffer(anchorAffinity, focusAffinity)) {
    return [];
  }
  const part = textPartOf(state, span, anchorAffinity, focusAffinity);
  const objects = coveredObjectRects(state, part.start, part.end, layoutTree);
  const rects = textSelectionRects(
    state, part.span, layoutTree, shaperOrMeasurer, part.anchorAffinity, part.focusAffinity, objects.skip,
  );
  for (const r of objects.rects) rects.push(r);
  return rects;
}

/** {@link computeSelectionRects}' text part: the lines of `span` (text endpoints), minus `skip`'s. */
function textSelectionRects(
  state: State,
  span: Span,
  layoutTree: LayoutBox,
  shaperOrMeasurer: TextShaper | TextMeasurer,
  anchorAffinity: CaretAffinity | undefined,
  focusAffinity: CaretAffinity | undefined,
  skip: ((blockId: BlockId) => boolean) | null,
): SelectionRect[] {
  const t = markStart("cursor.selection-geometry");
  try {
    // A logically-collapsed span (same offset) is VISUALLY non-empty when
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

    // Visual-extent: map anchor/focus affinities to DOCUMENT order. The
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

    // Shared with cursor-position + line-navigation via the
    // WeakMap-cached LineIndex; only the first consumer per layout
    // cycle pays the collectLineBoxes walk.
    //
    // Context isolation: `.all` includes the
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
      if (skip?.(al.line.ownerBlockId) === true) continue;
      const lineRects = emitLineRect(
        al,
        i === startLineIdx,
        i === endLineIdx,
        start.offset,
        end.offset,
        measurer,
        startAffinity,
        endAffinity,
        endMarkInterval(layoutTree, al),
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
 * {@link computeSelectionRectsAcrossPages}, which calls THIS function once per
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
  return computeSelectionRectsForPageRange(
    state, span, pageBox, pageIndex, startPos.pageIndex, endPos.pageIndex,
    shaperOrMeasurer, anchorAffinity, focusAffinity,
  );
}

/**
 * Selection rects for a span whose boundary block straddles a page break, WITHOUT
 * materializing the whole tree: resolve the span's start/end pixel positions once
 * against the virtual tree, then union {@link computeSelectionRectsForPageRange}
 * over the pages the span covers (it self-culls), so the result equals
 * `computeSelectionRects` over the materialized tree while materializing only the
 * spanned pages. An OBJECT endpoint (a table split across pages, `(tableId, 0)`)
 * covers its whole box, so the range runs over every page carrying one of its
 * fragments.
 */
export function computeSelectionRectsAcrossPages(
  state: State,
  span: Span,
  tree: VirtualLayoutTree,
  shaperOrMeasurer: TextShaper | TextMeasurer,
  anchorAffinity?: CaretAffinity,
  focusAffinity?: CaretAffinity,
): SelectionRect[] {
  const start = spanStart(state, span);
  const end = spanEnd(state, span);
  const startPos = resolvePixelPosition(state, start, tree, shaperOrMeasurer);
  const endPos = resolvePixelPosition(state, end, tree, shaperOrMeasurer);
  if (startPos === null || endPos === null) return [];
  // `startPos`/`endPos` were resolved against `tree`, so every index in
  // [startPos.pageIndex, endPos.pageIndex] is a valid page (getPage throws only
  // on out-of-range); the object walks stay inside the page count.
  const startPage = isTextPosition(state, start) ? startPos.pageIndex : objectPages(state, tree, start.blockId, startPos.pageIndex).first;
  const endPage = isTextPosition(state, end) ? endPos.pageIndex : objectPages(state, tree, end.blockId, endPos.pageIndex).last;
  const rects: SelectionRect[] = [];
  for (let p = startPage; p <= endPage; p++) {
    rects.push(
      ...computeSelectionRectsForPageRange(
        state, span, tree.getPage(p), p, startPage, endPage, shaperOrMeasurer,
        anchorAffinity, focusAffinity,
      ),
    );
  }
  return rects;
}

/** The pages around `page` (one it is on) carrying a fragment of object `id`'s box. */
function objectPages(state: State, tree: VirtualLayoutTree, id: BlockId, page: number): { first: number; last: number } {
  const on = (p: number): boolean => getObjectBoxes(tree.getPage(p), state).some((b) => b.blockId === id);
  let first = page;
  let last = page;
  while (first > 0 && on(first - 1)) first--;
  while (last + 1 < tree.plan.entries.length && on(last + 1)) last++;
  return { first, last };
}

/**
 * {@link computeSelectionRectsForPage} given only the PAGE INDICES the span's
 * start and end land on — all it reads from the resolved pixel positions. Lets a
 * caller that already knows a block's page (e.g. from the page plan) skip the
 * pixel-position resolution.
 */
export function computeSelectionRectsForPageRange(
  state: State,
  span: Span,
  pageBox: LayoutBox,
  pageIndex: number,
  startPage: number,
  endPage: number,
  shaperOrMeasurer: TextShaper | TextMeasurer,
  anchorAffinity?: CaretAffinity,
  focusAffinity?: CaretAffinity,
): SelectionRect[] {
  // As in `computeSelectionRects`, a logically-collapsed span is VISUALLY
  // non-empty at a bidi boundary when the affinities differ (the dual-caret
  // case). Only short-circuit when BOTH logically and visually collapsed. Every
  // affinity-less caller keeps the byte-identical early return.
  if (positionsEqual(span.anchor, span.focus) && !affinitiesDiffer(anchorAffinity, focusAffinity)) {
    return [];
  }
  if (pageIndex < startPage || pageIndex > endPage) return [];
  const part = textPartOf(state, span, anchorAffinity, focusAffinity);
  const objects = coveredObjectRects(state, part.start, part.end, pageBox);
  const rects = textSelectionRectsForPage(
    state, part.span, pageBox, pageIndex,
    part.startMoved ? null : startPage, part.endMoved ? null : endPage, shaperOrMeasurer,
    part.anchorAffinity, part.focusAffinity, objects.skip,
  );
  for (const r of objects.rects) rects.push(r);
  return rects;
}

/**
 * {@link computeSelectionRectsForPageRange}' text part on one page: the lines of
 * `span` (text endpoints) minus `skip`'s. `startPage` / `endPage` are the pages
 * the span's start / end land on, or `null` when unknown (the endpoint was clipped
 * off an object endpoint, so it may sit on another page than the range's end):
 * the endpoint's line is then looked up on this page, and a page wholly before /
 * after it gets no text there.
 */
function textSelectionRectsForPage(
  state: State,
  span: Span,
  pageBox: LayoutBox,
  pageIndex: number,
  startPage: number | null,
  endPage: number | null,
  shaperOrMeasurer: TextShaper | TextMeasurer,
  anchorAffinity: CaretAffinity | undefined,
  focusAffinity: CaretAffinity | undefined,
  skip: ((blockId: BlockId) => boolean) | null,
): SelectionRect[] {
  const t = markStart("cursor.selection-geometry");
  try {
    if (positionsEqual(span.anchor, span.focus) && !affinitiesDiffer(anchorAffinity, focusAffinity)) {
      return [];
    }

    const measurer: TextMeasurer = isTextShaper(shaperOrMeasurer)
      ? adaptShaperToMeasurer(shaperOrMeasurer)
      : shaperOrMeasurer;

    const start = spanStart(state, span);
    const end = spanEnd(state, span);

    // Visual-extent: map anchor/focus affinities to DOCUMENT order (see
    // `computeSelectionRects` for the rationale on the `comparePositions` boolean).
    const anchorIsStart = comparePositions(state, span.anchor, span.focus) <= 0;
    const startAffinity = anchorIsStart ? anchorAffinity : focusAffinity;
    const endAffinity = anchorIsStart ? focusAffinity : anchorAffinity;

    // Context isolation: on a page carrying both body and
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
    const startHere = startPage === null ? lineHolding(pageLines, start) >= 0 : pageIndex === startPage;
    const endHere = endPage === null ? lineHolding(pageLines, end) >= 0 : pageIndex === endPage;
    const lo = startHere
      ? findLineForPosition(pageLines, start)
      : startPage === null && !linesFrom(state, pageLines, start) ? -1 : 0;
    const hi = endHere
      ? findLineForPosition(pageLines, end)
      : endPage === null && !linesUpTo(state, pageLines, end) ? -1 : pageLines.length - 1;
    if (lo < 0 || hi < 0) return [];

    const rects: SelectionRect[] = [];
    for (let i = lo; i <= hi; i++) {
      const pl = pageLines[i];
      if (pl === undefined) {
        throw new Error(`selection-geometry: pageLines[${i}] missing (unreachable)`);
      }
      if (skip?.(pl.line.ownerBlockId) === true) continue;
      const lineRects = emitLineRect(
        pl,
        startHere && i === lo,
        endHere && i === hi,
        start.offset,
        end.offset,
        measurer,
        startAffinity,
        endAffinity,
        endMarkInterval(pageBox, pl),
      );
      for (const r of lineRects) rects.push(r);
    }
    return rects;
  } finally {
    markEnd("cursor.selection-geometry", t);
  }
}

/** The index of the line in `lines` holding `pos` (its block, its offset range), or -1. */
function lineHolding(lines: readonly AbsoluteLineBox[], pos: Position): number {
  return lines.findIndex(
    (l) => l.line.ownerBlockId === pos.blockId && l.line.inlineOffsetStart <= pos.offset && pos.offset <= l.line.inlineOffsetEnd,
  );
}

/** Do this page's `lines` (none holding `start`) come after `start` in document order? */
function linesFrom(state: State, lines: readonly AbsoluteLineBox[], start: Position): boolean {
  const first = lines[0];
  return first !== undefined &&
    comparePositions(state, createPosition(first.line.ownerBlockId, first.line.inlineOffsetStart), start) >= 0;
}

/** Do this page's `lines` (none holding `end`) come before `end` in document order? */
function linesUpTo(state: State, lines: readonly AbsoluteLineBox[], end: Position): boolean {
  const last = lines[lines.length - 1];
  return last !== undefined &&
    comparePositions(state, createPosition(last.line.ownerBlockId, last.line.inlineOffsetEnd), end) <= 0;
}

/**
 * A range's TEXT part and its document-order endpoints. A range endpoint on an
 * object block (`isObjectBlock`: an atomic leaf or a table, `(blockId, 0)`) covers
 * that whole block, so the text part is `clipSpanToText` (it starts / ends at the
 * first text after / last text before the object); the object itself paints via
 * {@link coveredObjectRects}. An affinity rides only on an endpoint the clip keeps.
 * A span with text endpoints is returned as is (no clip, affinities unchanged).
 */
function textPartOf(
  state: State,
  span: Span,
  anchorAffinity: CaretAffinity | undefined,
  focusAffinity: CaretAffinity | undefined,
): {
  readonly span: Span;
  readonly anchorAffinity: CaretAffinity | undefined;
  readonly focusAffinity: CaretAffinity | undefined;
  readonly start: Position;
  readonly end: Position;
  /** The text part's start / end is not the range's (clipped off an object endpoint). */
  readonly startMoved: boolean;
  readonly endMoved: boolean;
} {
  const anchorIsStart = comparePositions(state, span.anchor, span.focus) <= 0;
  const start = anchorIsStart ? span.anchor : span.focus;
  const end = anchorIsStart ? span.focus : span.anchor;
  if (isTextPosition(state, start) && isTextPosition(state, end)) {
    return { span, anchorAffinity, focusAffinity, start, end, startMoved: false, endMoved: false };
  }
  const clipped = clipSpanToText(state, span);
  const startAffinity = anchorIsStart ? anchorAffinity : focusAffinity;
  const endAffinity = anchorIsStart ? focusAffinity : anchorAffinity;
  const startMoved = !positionsEqual(clipped.anchor, start);
  const endMoved = !positionsEqual(clipped.focus, end);
  return {
    span: clipped,
    anchorAffinity: startMoved ? undefined : startAffinity,
    focusAffinity: endMoved ? undefined : endAffinity,
    start,
    end,
    startMoved,
    endMoved,
  };
}

function isTextPosition(state: State, pos: Position): boolean {
  return (resolveBlock(state, pos.blockId)?.block.inlineContent ?? null) !== null;
}

/**
 * The highlight of every object block the range `[start, end]` covers WHOLE
 * (Word / Google Docs: an object paragraph is selected whole or not at all), on
 * `tree` (one page, or a whole positioned tree): each covered object's box
 * fragment, outermost only (an object inside a covered table is the table's).
 * `skip` names the blocks whose LINES the text part must leave out — those inside
 * a covered table, whose box already carries the highlight — or is `null` when no
 * table is covered (the text part is then unchanged).
 *
 * An object `B` is covered when `start ≤ (B, 0) ≤ end` in document order and
 * neither endpoint lies strictly inside `B` (both endpoints in one table's cells
 * cover only that text). Cost: O(object fragments on `tree` × depth); the fragment
 * list is cached per tree, so a page without objects pays nothing.
 */
function coveredObjectRects(
  state: State,
  start: Position,
  end: Position,
  tree: LayoutBox,
): { readonly rects: SelectionRect[]; readonly skip: ((blockId: BlockId) => boolean) | null } {
  const rects: SelectionRect[] = [];
  // A range inside one text block covers no block (decorations, most selections).
  if (start.blockId === end.blockId) return { rects, skip: null };
  const boxes = getObjectBoxes(tree, state);
  if (boxes.length === 0) return { rects, skip: null };
  const context = selectionContextOf(state, start.blockId);
  const inStart = ancestorChain(state, start.blockId);
  const inEnd = ancestorChain(state, end.blockId);
  const covered = new Map<BlockId, boolean>();
  const isCovered = (id: BlockId): boolean => {
    let c = covered.get(id);
    if (c === undefined) {
      const pos = createPosition(id, 0);
      c = selectionContextOf(state, id) === context &&
        comparePositions(state, start, pos) <= 0 &&
        comparePositions(state, pos, end) <= 0 &&
        (id === start.blockId || !inStart.includes(id)) &&
        (id === end.blockId || !inEnd.includes(id));
      covered.set(id, c);
    }
    return c;
  };
  const coveredTables = new Set<BlockId>();
  for (const b of boxes) {
    if (isCovered(b.blockId) && resolveBlock(state, b.blockId)?.block.type === "table") coveredTables.add(b.blockId);
  }
  // Strictly inside a covered table: its box is the highlight.
  const insideCoveredTable = (id: BlockId): boolean =>
    coveredTables.size > 0 && ancestorChain(state, id).some((a, i) => i > 0 && coveredTables.has(a));
  for (const b of boxes) {
    if (!isCovered(b.blockId) || insideCoveredTable(b.blockId)) continue;
    const { x, y, width, height, pageIndex } = b.rect;
    rects.push({ x, y, width, height, pageIndex });
  }
  return { rects, skip: coveredTables.size > 0 ? insideCoveredTable : null };
}

/**
 * Project an INLINE interval (`[inlineLo, inlineHi]` along the inline axis) plus
 * a BLOCK band (`blockLo`, extent `blockSize` along the block axis) into a TRUE
 * PHYSICAL `SelectionRect`-shaped `{x, y, width, height}` via the line's axis
 * map. `SelectionRect` feeds paint directly, so unlike `PixelPosition`
 * (which stays inline/block) it must be physical here.
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
 * Bidi-aware: the partial branches (same-line, first-line,
 * last-line) segment the line-local logical range into its VISUAL intervals via
 * `selectionRectsForLineRange`, so a range crossing a direction boundary draws
 * >= 2 disjoint rects (never the old single `endX - startX` strip, which could
 * go NEGATIVE on a reordered line). The middle-full-line branch keeps
 * `computeLineEdges` (already direction-safe: a min/max over all leaf
 * positions). A covered ¶ (a block-boundary first/middle line) adds the ¶
 * extension (`paragraphExtension`), fused onto a content interval it touches.
 *
 * Writing-mode-aware: all geometry below is computed in INLINE/BLOCK
 * terms (the selected inline span + the line's block band) and projected to a
 * TRUE PHYSICAL `SelectionRect` via `physicalRectFromAxes` at the LAST step. The
 * `VisualInterval {xLo,xHi}` from `selectionRectsForLineRange` are INLINE-axis
 * intervals — they are projected HERE, never re-projected in line-bidi.
 * The ¶ extension is an INLINE interval, fused BEFORE projection. For h-tb the projection is identity (byte-identical).
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
  // The tracked ¶ glyph's / section label's extent at this block end, if drawn.
  endMark?: InlineInterval,
): SelectionRect[] {
  const line = al.line;
  const am = axisMapFor(line.writingMode, line.computedStyle.direction);
  const { inlineLo: lineInlineLo, inlineHi: lineInlineHi, trailingStyle } =
    computeLineEdges(al, am);
  // The ¶ extension: a block-boundary line whose ¶ the selection covers
  // (it continues past this line) paints one rect anchored at the caret paint
  // position of (P, len), advancing along the line's base direction (RTL →
  // leftward, vertical → down) by the two-space indicator width, widened to a drawn
  // tracked ¶ / section label.
  const ext = line.isBlockBoundaryLine && !isGlobalLast ? paragraphExtension(al, am, measurer, trailingStyle, endMark) : null;

  // The line's block band — shared by every rect emitted for this line. Both
  // are physical coords (start coords are pre-physicalized; the extent projects
  // the logical block-size to its physical axis).
  const blockLo = lineCoordOf(al, am.block);
  const blockSize = lineSizeAlong(al, am.block);

  // Inline intervals of this line's highlight, projected to physical at the end.
  const spans: { lo: number; hi: number }[] = [];
  const push = (inlineLo: number, inlineHi: number): void => {
    if (inlineHi - inlineLo > 0) spans.push({ lo: inlineLo, hi: inlineHi });
  };
  const done = (): SelectionRect[] => {
    if (ext !== null) {
      // Fused onto a content interval it touches (a pure-LTR line stays ONE rect).
      const touching = spans.find((sp) => sp.hi >= ext.lo - INDICATOR_EPSILON && sp.lo <= ext.hi + INDICATOR_EPSILON);
      if (touching !== undefined) {
        touching.lo = Math.min(touching.lo, ext.lo);
        touching.hi = Math.max(touching.hi, ext.hi);
      } else {
        push(ext.lo, ext.hi);
      }
    }
    return spans.map((sp) => physicalRectFromAxes(am, sp.lo, sp.hi, blockLo, blockSize, al.pageIndex));
  };

  if (!isGlobalFirst && !isGlobalLast) {
    // Middle full line: the whole line's content (direction-safe via the
    // min/max over leaf positions), plus the ¶ extension.
    push(lineInlineLo, lineInlineHi);
    return done();
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
    // Strut-only line (empty paragraph): no caret-target leaves; its content
    // edges collapse to the line inline-start, so only the ¶ extension shows
    // — on a first / middle line (an empty LAST line contributes
    // nothing visible).
    return done();
  }

  // VISUAL-EXTENT path. When the keyboard supplied a bidi-boundary affinity
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
    // Same-line selection: both endpoints land on this line (no ¶ covered).
    const sx = inlineCoordForOffset(view, rangeStart, startAffinity, measurer);
    const ex = inlineCoordForOffset(view, rangeEnd, endAffinity, measurer);
    push(Math.min(sx, ex), Math.max(sx, ex));
    return done();
  }
  if (isGlobalFirst && !isGlobalLast && startAffinity !== undefined) {
    // First line of a multi-line selection: from the anchor's resolved visual
    // coord to the line's inline end (+ the ¶ extension).
    push(inlineCoordForOffset(view, rangeStart, startAffinity, measurer), lineInlineHi);
    return done();
  }
  if (isGlobalLast && !isGlobalFirst && endAffinity !== undefined) {
    // Last line of a multi-line selection: from the line's inline start to the
    // focus's resolved visual coord (its ¶ is not covered).
    push(lineInlineLo, inlineCoordForOffset(view, rangeEnd, endAffinity, measurer));
    return done();
  }

  for (const seg of selectionRectsForLineRange(view, rangeStart, rangeEnd, measurer)) {
    push(seg.xLo, seg.xHi);
  }
  return done();
}

/**
 * The ¶ extension of a block-boundary line, in INLINE coordinates: the
 * hanging-¶ box anchored at the caret paint position of (P, len) (bidi, the
 * trailing-space clamp, vertical), `width("  ")` long along the base direction, widened to the
 * drawn tracked ¶ / section label (`endMark`) when one is shown, stopped at the line end
 * when an inline-end float shortens the line (`LineBox.endsAtFloat`) and clipped by the
 * line's `ancestorClip`, as the glyph is (null when clipped away entirely).
 */
function paragraphExtension(
  al: AbsoluteLineBox,
  am: AxisMap,
  measurer: TextMeasurer,
  trailingStyle: ComputedStyle,
  endMark: InlineInterval | undefined,
): InlineInterval | null {
  const w = measurer.measureWidth("  ", trailingStyle);
  const caret = resolvePositionInOwnLines([al], createPosition(al.line.ownerBlockId, al.line.inlineOffsetEnd), measurer, "before");
  const lo = am.inlineReversed ? caret.x - w : caret.x;
  const hi = am.inlineReversed ? caret.x : caret.x + w;
  let ext = endMark === undefined ? { lo, hi } : { lo: Math.min(lo, endMark.lo), hi: Math.max(hi, endMark.hi) };
  if (al.line.endsAtFloat === true) {
    // An inline-end float shortens the line: stop at the line end (the float's margin
    // box), as the ¶ glyph does. The extension starts at the caret, inside the line, so
    // keeping it within the line's span cuts only its inline-end side (either direction).
    const start = lineCoordOf(al, am.inline);
    ext = { lo: Math.max(ext.lo, start), hi: Math.min(ext.hi, start + lineSizeAlong(al, am.inline)) };
  }
  // Clipped as the ¶ glyph is: the line's ancestor clip (cell border box, column, page).
  if (al.ancestorClip === undefined) return ext;
  const clip = clipInFrame(al.ancestorClip, al.inverseTransform);
  if (clip === null) return null;
  const clo = am.inline === "x" ? clip.x0 : clip.y0;
  const chi = am.inline === "x" ? clip.x1 : clip.y1;
  return ext.hi <= clo || ext.lo >= chi ? null : { lo: Math.max(ext.lo, clo), hi: Math.min(ext.hi, chi) };
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
 * Object-selection geometry. Return the `SelectionRect` (absolute physical
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
