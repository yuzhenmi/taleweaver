import { resolveBlock, createPosition } from "../state";
import type { State, Position } from "../state";
import type { LayoutBox } from "../layout/layout-node";
import type { TextShaper } from "../layout/text-shaper";
import type { TextMeasurer } from "../layout/text-measurer";
import { isTextShaper, adaptShaperToMeasurer } from "../layout/text-measurer";
import type { ComputedStyle } from "../styles";
import {
  getLineIndex,
  collectLineLeaves,
} from "./line-flatten";
import { markStart, markEnd } from "../perf/perf-trace";

/**
 * Resolve a pixel (x, y) coordinate to a document Position using the
 * layout tree.
 *
 * Algorithm (LineBox-canonical; see
 * `docs/superpowers/specs/2026-05-23-linebox-canonical-anchor-design.md`):
 *   1. Collect every `LineBox` with absolute coords via
 *      `collectLineBoxes` (line identity is the LineBox reference, not
 *      a `(pageIndex, absoluteY)` tuple — float-Y fragility resolved).
 *   2. Filter to the requested `pageIndex` when the doc is paginated.
 *   3. Pick the line whose vertical range `[absoluteY,
 *      absoluteY + line.blockSize]` contains `y`, falling back to the
 *      last line for clicks below all content. Sub-pixel snap at line
 *      boundaries (0.5 px tolerance to the next line's top).
 *   4. Empty line (no leaf children): return
 *      `Position(line.ownerBlockId, line.inlineOffsetStart)`. No
 *      synthetic-strut fallback needed — the LineBox itself carries
 *      the owning block and the offset.
 *   5. Within the picked line, walk leaves (text-runs +
 *      inline-blocks) in visual order via `collectLineLeaves`. Pick
 *      the leaf whose X range contains `x`; fall back to the last
 *      leaf for clicks past line end.
 *   6. For text-run leaves: `findCharOffset` over the run's text.
 *      For inline-block leaves: cursor lands at the position just
 *      before the embed (charOffset = 0).
 *   7. Position = `(line.ownerBlockId, line.inlineOffsetStart +
 *      withinLineOffset + charOffset)`, where `withinLineOffset` is
 *      the sum of preceding leaves' `offsetContribution`.
 *
 * Returns `null` when:
 *   - The layout has no lines (e.g., empty document).
 *   - The picked line's `ownerBlockId` is unknown to `state`
 *     (defensive — shouldn't happen with consistent state + layout).
 */
export function resolvePositionFromPixel(
  state: State,
  layoutTree: LayoutBox,
  shaperOrMeasurer: TextShaper | TextMeasurer,
  x: number,
  y: number,
  pageIndex: number = 0,
): Position | null {
  const t = markStart("cursor.hit-test");
  try {
    const measurer: TextMeasurer = isTextShaper(shaperOrMeasurer)
      ? adaptShaperToMeasurer(shaperOrMeasurer)
      : shaperOrMeasurer;

    // 1. Collect every LineBox with absolute coords. Uses the
    // WeakMap-cached LineIndex (L-PERF-D) so this walk is shared with
    // cursor-position / line-navigation / selection-geometry within
    // the same layout cycle. Critical for up/down keystrokes:
    // line-navigation's moveToLine calls resolvePositionFromPixel
    // (this function) after consulting the index itself — without the
    // shared cache the tree would be walked twice per keystroke.
    const allLines = getLineIndex(layoutTree).all;
    if (allLines.length === 0) return null;

    // 2. Filter to target page when paginated.
    const hasPagination = allLines.some((l) => l.pageIndex > 0);
    const visible = hasPagination
      ? allLines.filter((l) => l.pageIndex === pageIndex)
      : allLines;
    if (visible.length === 0) return null;

    // 3. Pick target line by Y.
    let targetIdx = visible.length - 1;
    for (let i = 0; i < visible.length; i++) {
      const l = visible[i];
      const lineBottom = l.absoluteY + l.line.blockSize;
      if (y < lineBottom || i === visible.length - 1) {
        // Sub-pixel snap: if the click is within 0.5 px of the next
        // line's top, prefer the next line. (Layout pixel rounding
        // can place a click exactly on the boundary.)
        if (i + 1 < visible.length && Math.abs(y - visible[i + 1].absoluteY) < 0.5) {
          targetIdx = i + 1;
        } else {
          targetIdx = i;
        }
        break;
      }
    }
    const targetLine = visible[targetIdx];
    const ownerBlockId = targetLine.line.ownerBlockId;
    // Defensive: ensure the picked line's owning block exists in state. Use
    // `resolveBlock` (not `getBlock`) so a click in a HEADER/FOOTER slot
    // (C.2c T6) resolves: a slot's body block lives in the `templateContents`
    // map, not the main `blocks` map — `getBlock` only checks main, so it would
    // reject the slot line. `resolveBlock` checks all three trees (main /
    // embed / template).
    if (resolveBlock(state, ownerBlockId) === null) return null;

    // 4-5. Collect leaves within the picked line.
    const leaves = collectLineLeaves(targetLine.line, targetLine.absoluteX);
    if (leaves.length === 0) {
      // Empty line (strut). LineBox is first-class — return the
      // line's start offset.
      return createPosition(ownerBlockId, targetLine.line.inlineOffsetStart);
    }

    // Pick target leaf by X. Default: last leaf for clicks past end.
    let targetLeafIdx = leaves.length - 1;
    for (let i = 0; i < leaves.length; i++) {
      const leaf = leaves[i];
      if (x < leaf.absoluteX) {
        targetLeafIdx = i > 0 ? i - 1 : i;
        break;
      }
      if (x < leaf.absoluteX + leaf.width) {
        targetLeafIdx = i;
        break;
      }
    }

    // 6. Char offset within the target leaf.
    const targetLeaf = leaves[targetLeafIdx];
    let charOffset: number;
    if (targetLeaf.kind === "text-run") {
      const localX = x - targetLeaf.absoluteX;
      charOffset = findCharOffset(
        targetLeaf.box.text,
        localX,
        targetLeaf.computedStyle,
        measurer,
      );
    } else {
      // Inline-block: cursor lands at the position just before the
      // embed item. (Equivalent state-model character is the embed's
      // 1 unit — its leading edge is the position before, trailing
      // edge would be +1; we choose leading here to match the prior
      // "click on embed → land on closest text-run" approximation.)
      charOffset = 0;
    }

    // 7. Accumulate within-line offset for all preceding leaves.
    let withinLineOffset = 0;
    for (let i = 0; i < targetLeafIdx; i++) {
      withinLineOffset += leaves[i].offsetContribution;
    }

    return createPosition(
      ownerBlockId,
      targetLine.line.inlineOffsetStart + withinLineOffset + charOffset,
    );
  } finally {
    markEnd("cursor.hit-test", t);
  }
}

/**
 * Find the character offset closest to a given X position within `text`.
 * Compares midpoints between adjacent character widths (so a click closer
 * to char i than to char i+1 returns i).
 *
 * Binary search on prefix widths, with memoization of each prefix
 * measurement so no prefix is measured twice. Worst case O(log n)
 * `measureWidth` calls. The previous implementation did a linear scan
 * with two `measureWidth` calls per iteration (one for prefix i, one
 * for prefix i-1) — O(n) calls, each internally O(prefix), giving
 * O(n²) total.
 */
function findCharOffset(
  text: string,
  localX: number,
  styles: Readonly<ComputedStyle>,
  measurer: TextMeasurer,
): number {
  if (localX <= 0) return 0;
  if (text.length === 0) return 0;

  const widthCache = new Map<number, number>();
  widthCache.set(0, 0);
  const widthOfPrefix = (n: number): number => {
    let v = widthCache.get(n);
    if (v === undefined) {
      v = measurer.measureWidth(text.slice(0, n), styles);
      widthCache.set(n, v);
    }
    return v;
  };

  // Past the midpoint of the last character: snap to end. Safe because
  // the `text.length === 0` guard above ensures text.length >= 1 here.
  const fullW = widthOfPrefix(text.length);
  const lastMidpoint = (widthOfPrefix(text.length - 1) + fullW) / 2;
  if (localX >= lastMidpoint) return text.length;

  // Binary-search the smallest i in [1, text.length] such that the
  // midpoint between prefix(i-1) and prefix(i) is strictly greater than
  // localX. Returning i-1 matches the original "click closer to char i
  // than char i+1 returns i" semantics.
  let lo = 1;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    const midpoint = (widthOfPrefix(mid - 1) + widthOfPrefix(mid)) / 2;
    if (midpoint > localX) hi = mid;
    else lo = mid + 1;
  }
  return lo - 1;
}
