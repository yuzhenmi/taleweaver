import type { LayoutBox, LineBox, TextRunBox, InlineBlockBox } from "../layout/layout-node";
import type { ComputedStyle } from "@taleweaver/core";
import { axisMapFor } from "@taleweaver/core";
import type { Position, BlockId, State } from "@taleweaver/core";
import { selectionContextOf } from "@taleweaver/core";
// Type-only import (no runtime cycle): `line-bidi.ts` imports VALUES from this
// file, so this file must not import values from it. `CaretAffinity` is a type,
// erased at compile time, so a type-only import is cycle-free.
import type { CaretAffinity } from "./line-bidi";
import type { Mat2D } from "@taleweaver/core";
import { compose, invert, fromTransformFns, resolveTransformOrigin } from "@taleweaver/core";

/**
 * A `LineBox` paired with its absolute (document-relative) coordinates
 * and the page it lives on. Produced by `collectLineBoxes` from a
 * layout tree.
 *
 * Coordinates are page-relative inside a paginated tree (the page's
 * own `(x, y)` is the page's document-relative origin; descendants use
 * the page's content-box frame). For non-paginated trees,
 * `(absoluteX, absoluteY)` are document-relative.
 *
 * Line identity is `line` (the LineBox reference itself) — the
 * canonical replacement for the prior `(pageIndex, absoluteY)` line
 * key. Two `AbsoluteLineBox` entries describe the same line iff
 * `a.line === b.line`.
 */
export interface AbsoluteLineBox {
  readonly line: LineBox;
  readonly absoluteX: number;
  readonly absoluteY: number;
  readonly pageIndex: number;

  /**
   * POSITIONING slice 5 — the inverse of the CUMULATIVE ancestor `transform`
   * chain that paints this line, baked at flatten time (hit-test approach (b)).
   * THREE states:
   *   - `undefined` → NO transform anywhere in the ancestor chain → the IDENTITY
   *     fast-path. The line's `(absoluteX, absoluteY)` bounds ARE its painted
   *     bounds, so hit-test runs the existing bounds test verbatim with ZERO
   *     overhead (the 99% untransformed document).
   *   - a `Mat2D` → an INVERTIBLE cumulative transform. The line's bounds stay
   *     PRE-transform (layout absolute coords); hit-test maps the click point
   *     through this inverse into the line's pre-transform space, THEN runs the
   *     existing bounds test. point-in-transformed-quad ≡ inverse-point-in-
   *     pretransform-rect, so this handles translate/rotate/scale uniformly,
   *     O(1) per transformed line.
   *   - `"singular"` → a degenerate cumulative transform (det 0, e.g. `scale(0)`)
   *     → the painted region is zero-area / invisible → hit-test SKIPS the line
   *     (no hit), matching CSS Transforms 1.
   * The forward (non-inverted) cumulative matrix is the same mechanism the named
   * selection-geometry / relative-caret follow-ups will reuse.
   */
  readonly inverseTransform?: Mat2D | "singular";
}

/**
 * Walk a layout tree, collecting every `LineBox` with absolute
 * coordinates. Only `LineBox` nodes are emitted — text-runs, markers,
 * and structural boxes are skipped.
 *
 * The walk DOES descend into a `LineBox`'s children, but only to
 * reach nested `LineBox`es living inside inline-block descendants
 * (their own BFC produces their own LineBoxes). A within-line
 * text-run is never emitted itself; consumers needing
 * character-precision walk `line.children` directly for that.
 *
 * For line-level geometry (selection-rect spans, line navigation,
 * hit-test by Y) the LineBox itself carries everything needed
 * (`ownerBlockId`, `inlineOffsetStart/End`, `isBlockBoundaryLine`,
 * `inlineSize`, `blockSize`, `baseline`).
 *
 * Replaces the text-run-driven flatten (`collectAllTextBoxes`) for
 * line-level consumers. Hit-test, cursor-position, selection-geometry,
 * and line-navigation all migrate from `AbsoluteTextBox[]` keyed by
 * `(pageIndex, absoluteY)` to `AbsoluteLineBox[]` keyed by the
 * `LineBox` reference.
 *
 * Page boundaries: PageBox is a frame; descendants are walked with
 * page-content-relative origin `(0, 0)` and the page's `pageIndex`.
 * The page's own `(x, y)` is document-relative and not part of the
 * descendant coordinate system.
 */
export function collectLineBoxes(
  box: LayoutBox,
  parentX: number,
  parentY: number,
  out: AbsoluteLineBox[],
  pageIndex: number = 0,
  // POSITIONING slice 5 — the CUMULATIVE forward `transform` matrix of every
  // transform-bearing ancestor of `box` (in the page-content coordinate frame),
  // or `undefined` for the identity (no transform in the chain → the 99% case,
  // zero overhead). Composed onto when descending into a transform-bearing box;
  // each emitted line bakes `invert(cumulative)` as its `inverseTransform`.
  cumulativeTransform?: Mat2D,
): void {
  if (box.type === "text-run" || box.type === "marker") return;
  if (box.type === "page") {
    // Header/footer SLOTS (C.2c T6) are page-local BlockBoxes laid into the top
    // / bottom margin bands, kept OUT of `box.children` as distinct named
    // fields. Walk them too so their lines enter the flat list AND
    // `getLineIndex(page).byBlock` — feeding hit-test, cursor-position, and
    // selection-geometry for slot content. Slot block ids are globally unique
    // (templateContents lives in its own map), so they never collide with body
    // ids in `byBlock`. Header BEFORE the body children (it paints above),
    // footer AFTER (below). Origin is the page-content frame `(0, 0)` — the
    // slot's own `(x, y)` (set by `materializePage` to the band origin) is
    // applied as the slot box is descended.
    if (box.headerSlot) collectLineBoxes(box.headerSlot, 0, 0, out, box.pageIndex);
    for (const child of box.children) {
      collectLineBoxes(child, 0, 0, out, box.pageIndex);
    }
    if (box.footerSlot) collectLineBoxes(box.footerSlot, 0, 0, out, box.pageIndex);
    // DA3: the footnote SLOT is a NAMED field (like header/footer), kept OUT of
    // `box.children`, so walk it BY NAME too. Its lines enter the flat list AND
    // `getLineIndex(page).byBlock`, feeding hit-test, cursor-position, and
    // selection-geometry for footnote-body content. Footnote-body block ids live
    // in `embedContents` (their own map), so they never collide with body ids in
    // `byBlock`. Page-content frame origin `(0, 0)`; the slot's own `(x, y)` is
    // applied as it is descended. Collected AFTER the footer in the flat list
    // (the footnote band sits below the page body content).
    if (box.footnoteSlot) collectLineBoxes(box.footnoteSlot, 0, 0, out, box.pageIndex);
    return;
  }
  const absX = parentX + box.x;
  const absY = parentY + box.y;

  // POSITIONING slice 5 — when this box carries a `transform`, compose its matrix
  // (about its transform-origin in the CURRENT accumulated absolute frame, exactly
  // as the painter does in `paintBox`) onto the cumulative ancestor transform. The
  // painter applies the ancestor transform FIRST (outer canvas state) then this
  // box's, so a local point maps boxMatrix-then-ancestor → the forward cumulative
  // is `compose(ancestorCumulative, boxMatrix)` (ancestor is the OUTER, applied
  // last). Descendants (and this box's own lines) inherit `childCumulative`.
  const childCumulative = transformAt(box, absX, absY, cumulativeTransform);

  if (box.type === "multicolumn") {
    // A MultiColumnBox is a CONTAINER whose `columns` (BlockBoxes) are descended
    // LEFT-TO-RIGHT. Because each column holds a CONTIGUOUS doc-order run, this
    // depth-first concatenation `[col-0 lines …][col-1 lines …]` IS visual reading
    // order (the VISUAL-ORDER GUARANTEE) — no reorder needed. Each column box is
    // positioned in THIS box's frame, so it descends with origin `(absX, absY)`;
    // the column a line belongs to is recoverable geometrically (the line's
    // `absoluteX` falls within that column box's inline range), which is exactly
    // how the column-aware hit-test (`locateColumnAtPoint`) picks a column.
    for (const col of box.columns) {
      collectLineBoxes(col, absX, absY, out, pageIndex, childCumulative);
    }
    collectAbsoluteLineBoxes(box, absX, absY, out, pageIndex, childCumulative);
    return;
  }

  if (box.type === "line") {
    out.push(makeAbsoluteLineBox(box, absX, absY, pageIndex, childCumulative));
    // LineBox children: most are text-runs (skipped by the text-run
    // branch). When an inline-block lives on this line, its own BFC
    // produced nested LineBoxes inside its children — descend so
    // those nested lines are also collected. Line-level consumers
    // call `line.children` directly when they need within-line
    // char-precision; the descent here is purely for the cross-
    // boundary case of inline-block-internal lines.
    for (const child of box.children) {
      collectLineBoxes(child, absX, absY, out, pageIndex, childCumulative);
    }
    collectAbsoluteLineBoxes(box, absX, absY, out, pageIndex, childCumulative);
    return;
  }
  for (const child of box.children) {
    collectLineBoxes(child, absX, absY, out, pageIndex, childCumulative);
  }
  // POSITIONING slice 3 (LOAD-BEARING) — descend `box.absoluteChildren` too. Abs-pos
  // content is reachable ONLY via `absoluteChildren` (it is OUT of `children`); if
  // this walk skipped it, every line inside an abs-pos subtree would be ABSENT from
  // `getLineIndex().all` → invisible to hit-test, cursor-position, selection-geometry,
  // AND line-navigation (the flat LineIndex is the single source of truth for all
  // cursor ops). Abs children are positioned in THIS box's own frame, so they descend
  // with the SAME parent origin `(absX, absY)` as `children`, and inherit THIS box's
  // cumulative transform (a transform on the abc-establishing box transforms its
  // abs-pos descendants too — CSS Transforms 1).
  collectAbsoluteLineBoxes(box, absX, absY, out, pageIndex, childCumulative);
}

/**
 * POSITIONING slice 5 — compose `box`'s `transform` (if any) about its
 * transform-origin onto the cumulative ancestor transform, returning the matrix
 * descendants inherit. When the box has no transform, the cumulative is unchanged
 * (returned verbatim, so the identity fast-path threads `undefined` through). The
 * transform-origin is resolved in the SAME accumulated absolute frame the painter
 * uses (`absX/absY + transformOrigin` against the box's border-box width/height),
 * so paint and hit-test share the IDENTICAL matrix.
 */
function transformAt(
  box: LayoutBox,
  absX: number,
  absY: number,
  cumulative: Mat2D | undefined,
): Mat2D | undefined {
  // Only a TRANSFORMABLE box carries an author transform (CSS Transforms 1 §3:
  // block-level + atomic-inline-level boxes). The IFC STAMPS its block's
  // `computedStyle` (incl. `transform`) onto the generated `line` fragments, and a
  // non-atomic `inline`/`text-run`/`marker` likewise copies a parent cs — so those
  // fragment types would RE-COMPOSE their establishing block's transform a second
  // time (double-counting it) if we read `transform` off them. Skip them; the
  // block/inline-block/table* box already composed the transform for the subtree.
  if (box.type === "line" || box.type === "text-run" || box.type === "marker" || box.type === "inline") {
    return cumulative;
  }
  const cs = box.computedStyle;
  if (cs.transform.length === 0) return cumulative;
  const origin = resolveTransformOrigin(cs.transformOrigin, absX, absY, box.width, box.height);
  const boxMatrix = fromTransformFns(cs.transform, origin.x, origin.y, box.width, box.height);
  // Ancestor cumulative is the OUTER (applied last by the painter); this box's
  // matrix is the INNER (applied first). `compose(outer, inner)` = inner-then-outer.
  return cumulative === undefined ? boxMatrix : compose(cumulative, boxMatrix);
}

/**
 * POSITIONING slice 5 — build an `AbsoluteLineBox`, baking the three-state
 * `inverseTransform` from the cumulative ancestor transform: `undefined`
 * cumulative → identity (field omitted, fast-path); a `Mat2D` → `invert` it
 * (`null` from a singular matrix → the `"singular"` sentinel so a degenerate
 * transform is type-safely distinguished from identity, no `!`); else the inverse.
 */
function makeAbsoluteLineBox(
  line: LineBox,
  absoluteX: number,
  absoluteY: number,
  pageIndex: number,
  cumulative: Mat2D | undefined,
): AbsoluteLineBox {
  if (cumulative === undefined) {
    return { line, absoluteX, absoluteY, pageIndex };
  }
  const inv = invert(cumulative);
  return {
    line,
    absoluteX,
    absoluteY,
    pageIndex,
    inverseTransform: inv === null ? "singular" : inv,
  };
}

/**
 * POSITIONING slice 3 — descend a box's `absoluteChildren` (if any) into the flat
 * LineBox list with the box's own accumulated origin. Factored out so both the
 * LineBox early-return branch and the generic-container branch share it. A no-op for
 * the overwhelmingly common box with no abs-pos descendants. The cumulative ancestor
 * `transform` (slice 5) threads through to the abs descendants unchanged.
 */
function collectAbsoluteLineBoxes(
  box: LayoutBox,
  absX: number,
  absY: number,
  out: AbsoluteLineBox[],
  pageIndex: number,
  cumulative: Mat2D | undefined,
): void {
  if (box.absoluteChildren === undefined) return;
  for (const absChild of box.absoluteChildren) {
    collectLineBoxes(absChild, absX, absY, out, pageIndex, cumulative);
  }
}

/**
 * Indexed view of every `AbsoluteLineBox` in a layout tree:
 *   - `all`: flat list in document order (same shape `collectLineBoxes`
 *     produces).
 *   - `byBlock`: lines grouped by their `ownerBlockId`, preserving
 *     document order within each group.
 *
 * Built lazily on first call to `getLineIndex(root)` and memoized via
 * a module-level `WeakMap<LayoutBox, LineIndex>`. Per-cursor-query
 * consumers (cursor-position, line-navigation, selection-geometry) all
 * pull from the same cached instance, so a single `collectLineBoxes`
 * walk amortizes across all consumers of one layout cycle. cursor-
 * position's `byBlock.get(blockId)` lookup is O(1); without the index
 * it had to walk every line in the doc and filter — O(N_lines) per
 * cursor query, dominant on large docs (L-PERF-D).
 */
export interface LineIndex {
  readonly all: readonly AbsoluteLineBox[];
  readonly byBlock: ReadonlyMap<BlockId, readonly AbsoluteLineBox[]>;
}

const _lineIndexCache: WeakMap<LayoutBox, LineIndex> = new WeakMap();

/**
 * Return the `LineIndex` for a layout-tree root, building it on first
 * access and caching by reference. The cache is a `WeakMap` keyed on
 * the root `LayoutBox`, so when a new layout cycle produces a new root
 * the old index becomes eligible for GC; subsequent calls within the
 * same cycle (same root) reuse the cached index.
 */
export function getLineIndex(root: LayoutBox): LineIndex {
  const cached = _lineIndexCache.get(root);
  if (cached !== undefined) return cached;
  const all: AbsoluteLineBox[] = [];
  collectLineBoxes(root, 0, 0, all);
  const byBlock = new Map<BlockId, AbsoluteLineBox[]>();
  for (const al of all) {
    let arr = byBlock.get(al.line.ownerBlockId);
    if (arr === undefined) {
      arr = [];
      byBlock.set(al.line.ownerBlockId, arr);
    }
    arr.push(al);
  }
  const index: LineIndex = { all, byBlock };
  _lineIndexCache.set(root, index);
  return index;
}

/**
 * Context filter (#327): constrain a flat line list to ONE editing context —
 * the page BODY and a header/footer SLOT are isolated editing contexts (Google
 * Docs convention: arrow keys never carry the caret across the body↔header
 * boundary; you CLICK into a header to edit it; SELECT_ALL highlights only the
 * context the caret is in).
 *
 * C.2c T6 made the per-page `LineIndex.all` include the header/footer slot lines
 * (in doc order each page is `[header lines, body lines, footer lines]`), so an
 * unfiltered consumer — line-navigation (#327) and selection-geometry — would
 * leak across the boundary: ArrowUp from the body's top line would step into the
 * header; a body select-all's rects would bleed into the interleaved
 * header/footer slot bands between pages. Each candidate line is kept only if
 * `selectionContextOf(state, line.ownerBlockId)` EQUALS `context`.
 *
 * Perf: `selectionContextOf` walks parentId to the tree root (O(depth)). The
 * returned closure MEMOIZES per `ownerBlockId` (a `Map`) so each block's context
 * resolves once per call, not once per line. For the common main-only page (no
 * header/footer slot lines) the filter still SCANS the lines once (O(unique
 * blocks × depth), memoized) but, finding every line already in `context`,
 * returns the SAME array reference unchanged — so no new array is allocated and
 * line order is byte-identical to the pre-#327 hot path (allocation-free, not
 * walk-free).
 *
 * Shared by `line-navigation.ts` (#327) and `selection-geometry.ts` (this
 * change) so both consumers apply identical isolation.
 */
export function makeContextFilter(
  state: State,
  context: BlockId | null,
): (lines: readonly AbsoluteLineBox[]) => readonly AbsoluteLineBox[] {
  const memo = new Map<BlockId, BlockId | null>();
  const ctxOf = (blockId: BlockId): BlockId | null => {
    const cached = memo.get(blockId);
    if (cached !== undefined) return cached;
    const ctx = selectionContextOf(state, blockId);
    memo.set(blockId, ctx);
    return ctx;
  };
  return (lines) => {
    // Fast-path probe: if every line already shares `context` (the common
    // main-only / single-context page), return the array unchanged so no new
    // array is allocated and order is byte-identical.
    let allSame = true;
    for (const lb of lines) {
      if (ctxOf(lb.line.ownerBlockId) !== context) {
        allSame = false;
        break;
      }
    }
    if (allSame) return lines;
    return lines.filter((lb) => ctxOf(lb.line.ownerBlockId) === context);
  };
}

/**
 * A leaf box within a LineBox (text-run or inline-block) paired with
 * its absolute X coordinate and state-model offset contribution. Used
 * by within-line hit-test and X-from-offset queries to find the
 * specific run that contains a given X / contains a given offset.
 *
 * Discriminated union: the `kind` field narrows `box` to its concrete
 * type (TextRunBox for text-runs, InlineBlockBox for inline-blocks),
 * so consumers can access `box.text` etc. without casts.
 *
 * `offsetContribution` is the STATE-character span this leaf owns,
 * matching the IFC's per-token accumulator rule: a text-run's
 * `offsetLength` (≥ its rendered `text.length` — strictly greater when
 * trailing collapsed whitespace was absorbed into the run, so cursor
 * offsets after a collapsed double space stay aligned with state
 * offsets), and `1` for an inline-block (state-model embed). Summed
 * across leaves, the total equals the line's
 * `inlineOffsetEnd - inlineOffsetStart`.
 */
export type LineLeaf =
  | {
      readonly kind: "text-run";
      readonly box: TextRunBox;
      readonly absoluteX: number;
      /** Absolute (document/page-relative) PHYSICAL-Y coordinate of the leaf. */
      readonly absoluteY: number;
      /** PHYSICAL-X extent of the leaf (`box.width`). */
      readonly width: number;
      /** PHYSICAL-Y extent of the leaf (`box.height`). */
      readonly height: number;
      /** Convenience copy from `box.computedStyle`. */
      readonly computedStyle: Readonly<ComputedStyle>;
      readonly offsetContribution: number;
    }
  | {
      readonly kind: "inline-block";
      readonly box: InlineBlockBox;
      readonly absoluteX: number;
      readonly absoluteY: number;
      readonly width: number;
      readonly height: number;
      readonly computedStyle: Readonly<ComputedStyle>;
      readonly offsetContribution: number;
    };

/**
 * The leaf's coordinate along a given PHYSICAL axis. Boxes are pre-physicalized
 * (P3.1), so `absoluteX`/`absoluteY` are the correct physical coords for every
 * writing mode. Consumers project a logical axis (`am.inline`/`am.block`) to its
 * physical letter via `axisMapFor`, then read the matching coord here.
 */
export function coordOf(leaf: LineLeaf, axis: "x" | "y"): number {
  return axis === "x" ? leaf.absoluteX : leaf.absoluteY;
}

/** The leaf's extent along a given PHYSICAL axis (mirror of `coordOf`). */
export function sizeAlong(leaf: LineLeaf, axis: "x" | "y"): number {
  return axis === "x" ? leaf.width : leaf.height;
}

/**
 * A LINE's coordinate along a given PHYSICAL axis. Unlike a leaf (which carries
 * both physical coords directly), an `AbsoluteLineBox` carries `absoluteX`/
 * `absoluteY` for the START coords but the line's EXTENT is stored LOGICALLY
 * (`inlineSize`/`blockSize`). The start coords are already physical, so the same
 * axis-letter read works; `lineSizeAlong` does the logical→physical projection.
 */
export function lineCoordOf(line: AbsoluteLineBox, axis: "x" | "y"): number {
  return axis === "x" ? line.absoluteX : line.absoluteY;
}

/**
 * A LINE's PHYSICAL extent along a given axis. The line's logical extents
 * (`inlineSize`/`blockSize`) project to physical x/y per the line's OWN axis map
 * (`axisMapFor(line.writingMode, line.computedStyle.direction)`): the inline
 * extent maps to `am.inline`'s physical axis, the block extent to `am.block`'s.
 * For h-tb (`inline→x`, `block→y`) this returns `inlineSize` along x and
 * `blockSize` along y — i.e. the physical width/height — identical to the old
 * direct reads.
 */
export function lineSizeAlong(line: AbsoluteLineBox, axis: "x" | "y"): number {
  const lb = line.line;
  const am = axisMapFor(lb.writingMode, lb.computedStyle.direction);
  return am.inline === axis ? lb.inlineSize : lb.blockSize;
}

/**
 * Walk a single `LineBox`'s subtree, emitting one `LineLeaf` per
 * leaf box (text-run or inline-block) in visual (post-bidi-reorder)
 * order. Descends into `InlineBox` children (which wrap groups of
 * same-inline-element text-runs) but stops at text-runs and inline-
 * blocks — they are the leaves.
 *
 * Skips MarkerBoxes (list bullets etc.) which don't contribute
 * cursor positions.
 *
 * Used by hit-test (pick target leaf by X within the picked line)
 * and by cursor-position (map Position → leaf for X measurement).
 */
export function collectLineLeaves(line: LineBox, lineAbsX: number, lineAbsY: number): LineLeaf[] {
  const out: LineLeaf[] = [];
  // Contract mismatch: `collectLineLeaves` is GIVEN the line's ABSOLUTE x
  // (`lineAbsX` = blockAbsX + line.x; the callers read it straight off the
  // `AbsoluteLineBox`). But `collectLeavesRec`'s `line`/`inline` branch expects
  // the PARENT-frame x and re-adds the box's own `.x` (`absX = parentX +
  // box.x`). So we hand it the parent-frame x (`lineAbsX - line.x`); the
  // recursion re-adds `line.x` exactly once, yielding `lineAbsX` for the line
  // and `lineAbsX + childRelX` for its children. This is what kills the
  // double-count that over-shifted the caret/selection/hit-test on lines whose
  // `.x` is non-zero (#336 fix). Post-#333, `line.x` is the natural inline-start
  // (typically 0; non-zero only for float-adjusted lines) — the alignment offset
  // now rides on the children's `inlineOffset` instead of `line.x`, so the
  // subtraction is a no-op for unfloated lines but still correct + load-bearing
  // for the floated case. Works in both writing directions because `box.x` IS
  // the physical coordinate, so `lineAbsX - line.x + line.x === lineAbsX`
  // regardless of LTR/RTL.
  //
  // P3.5a: the SAME parent-frame contract applies to the block axis (`parentY`).
  // We hand `lineAbsY - line.y`; the recursion re-adds `line.y` exactly once,
  // yielding `lineAbsY` for the line and `lineAbsY + childRelY` for its children.
  // Boxes are pre-physicalized (P3.1), so `box.y` is the physical-Y coordinate in
  // every writing mode — this stamps `leaf.absoluteY`/`leaf.height` symmetrically
  // to the X fields. h-tb is byte-identical because these fields were never read
  // before; they exist to let vertical consumers read the inline axis (which maps
  // to physical Y) via `coordOf(leaf, "y")`.
  collectLeavesRec(line, lineAbsX - line.x, lineAbsY - line.y, out);
  return out;
}

/**
 * THE single soft-wrap line picker (CUR-3). Returns the index of the
 * `AbsoluteLineBox` that owns `position`, applying the doc-wide soft-wrap rule
 * uniformly:
 *
 *   - Walk the FLAT list in document order; only `position.blockId`'s own lines
 *     are candidates (foreign-block lines — the interleaved inline-block-internal
 *     lines that `collectLineBoxes` emits BETWEEN a wrapped outer paragraph's own
 *     lines — are skipped). The last own-line is returned for a past-block-end
 *     offset.
 *   - Soft-wrap preference: at an EXACT line-end boundary
 *     (`position.offset === l.inlineOffsetEnd`) with a NEXT same-block line, the
 *     caret has wrapped onto that next line, so prefer its start (Word / Google
 *     Docs convention — typing up to the wrap lands the caret on the new line).
 *   - Affinity opt-out (#474 B2): an explicit `caretAffinity === "before"` pins
 *     the caret to THIS line's END instead of jumping to the next line's start,
 *     so the end-of-a-wrapped-line caret position stays reachable (set by a click
 *     at the wrapped line's visual end, or a left-arrow back across the boundary).
 *     `undefined`/`"after"` take the default next-line preference.
 *
 * Returns -1 when no line owns `position.blockId` (e.g. a container block with
 * null inlineContent → no LineBoxes).
 *
 * This is the ONE implementation of the rule. Three callers used to re-derive it
 * with diverging affinity / foreign-line handling (`findLineForPosition`,
 * `resolvePositionInOwnLines`, and visual-motion's `pickLine`); they now all
 * delegate here so the rule can't drift. The foreign-line skip is a no-op for
 * block-FILTERED callers (their list contains only same-block lines), so they get
 * identical results to a flat-list caller.
 */
export function pickSoftWrapLine(
  lines: readonly AbsoluteLineBox[],
  position: Position,
  caretAffinity?: CaretAffinity,
): number {
  // Walk the full list (don't early-exit on foreign-block entries):
  // `collectLineBoxes` interleaves inline-block-internal lines into
  // the flat array, so a wrapped outer paragraph containing an
  // inline-block has foreign-block lines BETWEEN its own lines. The
  // last matching candidate is what we return for past-block-end
  // offsets.
  let candidate = -1;
  for (let i = 0; i < lines.length; i++) {
    const lineBox = lines[i];
    if (lineBox === undefined) {
      throw new Error(`pickSoftWrapLine: lines[${i}] missing (unreachable)`);
    }
    const l = lineBox.line;
    if (l.ownerBlockId !== position.blockId) continue;
    candidate = i;
    if (position.offset < l.inlineOffsetStart) {
      return i;
    }
    if (position.offset <= l.inlineOffsetEnd) {
      const isExactEnd = position.offset === l.inlineOffsetEnd;
      // At the soft-wrap boundary, prefer the NEXT same-block line's start —
      // UNLESS `caretAffinity === "before"` pins the caret to THIS line's end.
      // Look ahead for the next same-block line (skipping any intervening
      // foreign-block lines from interleaved inline-block descendants).
      if (isExactEnd && caretAffinity !== "before") {
        for (let j = i + 1; j < lines.length; j++) {
          const next = lines[j];
          if (next === undefined) {
            throw new Error(`pickSoftWrapLine: lines[${j}] missing (unreachable)`);
          }
          if (next.line.ownerBlockId === position.blockId) {
            return j;
          }
        }
      }
      return i;
    }
  }
  return candidate;
}

/**
 * Find the index of the `AbsoluteLineBox` that contains `position`.
 * Returns -1 if no line owns the position's block (e.g. block has
 * no LineBoxes — container block with null inlineContent).
 *
 * Soft-wrap preference: at `position.offset === current.inlineOffsetEnd`
 * with a next line for the same block, prefer the next line's start.
 * This matches Word / Google Docs caret behavior at visual wrap edges.
 *
 * Affinity-blind (passes no `caretAffinity`): the existing
 * `selection-geometry` / `line-navigation` callers resolve the line for
 * the caret/selection ENDS without an affinity, so this preserves their
 * behavior exactly. Delegates to {@link pickSoftWrapLine} (CUR-3) so the
 * soft-wrap rule lives in ONE place.
 *
 * Consumed by `cursor-position` and `selection-geometry` to anchor
 * Position → line lookups.
 */
export function findLineForPosition(lines: readonly AbsoluteLineBox[], position: Position): number {
  return pickSoftWrapLine(lines, position, undefined);
}

function collectLeavesRec(box: LayoutBox, parentX: number, parentY: number, out: LineLeaf[]): void {
  if (box.type === "text-run") {
    out.push({
      kind: "text-run",
      box,
      absoluteX: parentX + box.x,
      absoluteY: parentY + box.y,
      width: box.width,
      height: box.height,
      computedStyle: box.computedStyle,
      // STATE-char span, not rendered text.length: a run that absorbed
      // trailing collapsed whitespace owns more offsets than it renders.
      offsetContribution: box.offsetLength,
    });
    return;
  }
  if (box.type === "inline-block") {
    out.push({
      kind: "inline-block",
      box,
      absoluteX: parentX + box.x,
      absoluteY: parentY + box.y,
      width: box.width,
      height: box.height,
      computedStyle: box.computedStyle,
      offsetContribution: 1,
    });
    return;
  }
  if (box.type === "marker") return;
  if (box.type === "multicolumn") {
    // A MultiColumnBox shouldn't appear as a line's descendant (columns are
    // block-axis containers, not within-line leaves); defensively descend its
    // `columns` with the same X/Y frame anyway, mirroring the container branch.
    for (const col of box.columns) {
      collectLeavesRec(col, parentX, parentY, out);
    }
    return;
  }
  if (box.type === "page" || box.type === "block" || box.type === "table" || box.type === "table-row" || box.type === "table-cell") {
    // Block-axis containers shouldn't appear as a line's descendants;
    // defensively descend with the same X/Y frame anyway.
    for (const child of box.children) {
      collectLeavesRec(child, parentX, parentY, out);
    }
    return;
  }
  // box.type === "line" or "inline" — descend with own X/Y offset.
  const absX = parentX + box.x;
  const absY = parentY + box.y;
  for (const child of box.children) {
    collectLeavesRec(child, absX, absY, out);
  }
}
