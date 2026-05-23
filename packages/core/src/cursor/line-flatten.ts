import type { LayoutBox, LineBox } from "../layout/layout-node";

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
