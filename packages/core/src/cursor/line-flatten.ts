import type { LayoutBox, LineBox, TextRunBox, InlineBlockBox } from "../layout/layout-node";
import type { ComputedStyle } from "../styles";
import type { Position } from "../state/block-position";
import type { BlockId } from "../state/block-id";

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
): void {
  if (box.type === "text-run" || box.type === "marker") return;
  if (box.type === "page") {
    for (const child of box.children) {
      collectLineBoxes(child, 0, 0, out, box.pageIndex);
    }
    return;
  }
  const absX = parentX + box.x;
  const absY = parentY + box.y;
  if (box.type === "line") {
    out.push({ line: box, absoluteX: absX, absoluteY: absY, pageIndex });
    // LineBox children: most are text-runs (skipped by the text-run
    // branch). When an inline-block lives on this line, its own BFC
    // produced nested LineBoxes inside its children — descend so
    // those nested lines are also collected. Line-level consumers
    // call `line.children` directly when they need within-line
    // char-precision; the descent here is purely for the cross-
    // boundary case of inline-block-internal lines.
    for (const child of box.children) {
      collectLineBoxes(child, absX, absY, out, pageIndex);
    }
    return;
  }
  for (const child of box.children) {
    collectLineBoxes(child, absX, absY, out, pageIndex);
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
      readonly width: number;
      /** Convenience copy from `box.computedStyle`. */
      readonly computedStyle: Readonly<ComputedStyle>;
      readonly offsetContribution: number;
    }
  | {
      readonly kind: "inline-block";
      readonly box: InlineBlockBox;
      readonly absoluteX: number;
      readonly width: number;
      readonly computedStyle: Readonly<ComputedStyle>;
      readonly offsetContribution: number;
    };

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
export function collectLineLeaves(line: LineBox, lineAbsX: number): LineLeaf[] {
  const out: LineLeaf[] = [];
  collectLeavesRec(line, lineAbsX, out);
  return out;
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
 * Consumed by `cursor-position` and `selection-geometry` to anchor
 * Position → line lookups.
 */
export function findLineForPosition(lines: readonly AbsoluteLineBox[], position: Position): number {
  // Walk the full list (don't early-exit on foreign-block entries):
  // `collectLineBoxes` interleaves inline-block-internal lines into
  // the flat array, so a wrapped outer paragraph containing an
  // inline-block has foreign-block lines BETWEEN its own lines. The
  // last matching candidate is what we return for past-block-end
  // offsets.
  let candidate = -1;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].line;
    if (l.ownerBlockId !== position.blockId) continue;
    candidate = i;
    if (position.offset < l.inlineOffsetStart) {
      return i;
    }
    if (position.offset <= l.inlineOffsetEnd) {
      const isExactEnd = position.offset === l.inlineOffsetEnd;
      // Look ahead for the NEXT same-block line (skipping any
      // intervening foreign-block lines from interleaved inline-
      // block descendants).
      if (isExactEnd) {
        for (let j = i + 1; j < lines.length; j++) {
          if (lines[j].line.ownerBlockId === position.blockId) {
            return j;
          }
        }
      }
      return i;
    }
  }
  return candidate;
}

function collectLeavesRec(box: LayoutBox, parentX: number, out: LineLeaf[]): void {
  if (box.type === "text-run") {
    out.push({
      kind: "text-run",
      box,
      absoluteX: parentX + box.x,
      width: box.width,
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
      width: box.width,
      computedStyle: box.computedStyle,
      offsetContribution: 1,
    });
    return;
  }
  if (box.type === "marker") return;
  if (box.type === "page" || box.type === "block" || box.type === "table" || box.type === "table-row" || box.type === "table-cell") {
    // Block-axis containers shouldn't appear as a line's descendants;
    // defensively descend with the same X frame anyway.
    for (const child of box.children) {
      collectLeavesRec(child, parentX, out);
    }
    return;
  }
  // box.type === "line" or "inline" — descend with own X offset.
  const absX = parentX + box.x;
  for (const child of box.children) {
    collectLeavesRec(child, absX, out);
  }
}
