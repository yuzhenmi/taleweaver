import { resolveBlock, createPosition, selectionContextOf } from "../state";
import type { State, Position } from "../state";
import type { AbsoluteLineBox } from "./line-flatten";
import type { LayoutBox } from "../layout/layout-node";
import type { PageBox } from "../layout/page-box";
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
 *      For inline-block leaves (a 1-unit embed, e.g. a footnote marker):
 *      split at the box midpoint — `charOffset = 0` (leading, before the
 *      embed) when `x` is in the left half, `charOffset = 1` (trailing,
 *      after the embed) when `x` is in the right half. Mirrors the
 *      nearest-edge rule `findCharOffset` applies to glyphs and is the
 *      inverse of `cursor-position.ts`'s inline-block offset→x mapping
 *      (0 → left edge, 1 → right edge), so click↔render round-trips.
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

    // 2b. Region-aware band partition (#331 / #332). Since C.2c T6 `visible` is
    // [header lines, body lines, footer lines] in ascending-y order. A click in
    // the body's empty TAIL (below the last body line, above the footer zone)
    // must clamp to the BODY — only a click in the footer ZONE enters the footer,
    // and only a click in the header ZONE enters the header (Google Docs). The
    // zones are the FULL top/bottom page margins (not just the slot text extents),
    // read off the PageBox's content-area edges. Without this, the step-3
    // nearest-y loop walks past the body lines and lands on a slot line. We
    // classify `visible` into a body set and slot zones, then pick the zone the
    // click `y` falls in.
    const region = pickRegionByBand(state, layoutTree, pageIndex, visible, y);

    // 3. Pick target line by Y within the chosen band. `region` is a filtered
    // subset of the ascending-y `visible`, so it stays ascending-y ordered.
    let targetIdx = region.length - 1;
    for (let i = 0; i < region.length; i++) {
      const l = region[i];
      const lineBottom = l.absoluteY + l.line.blockSize;
      if (y < lineBottom || i === region.length - 1) {
        // Sub-pixel snap: if the click is within 0.5 px of the next
        // line's top, prefer the next line. (Layout pixel rounding
        // can place a click exactly on the boundary.)
        if (i + 1 < region.length && Math.abs(y - region[i + 1].absoluteY) < 0.5) {
          targetIdx = i + 1;
        } else {
          targetIdx = i;
        }
        break;
      }
    }
    const targetLine = region[targetIdx];
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
      // `findCharOffset` searches `targetLeaf.box.text` by measured width, so it
      // returns a DISPLAY code-unit offset into that string. For a length-
      // changing text-transform leaf (e.g. uppercase ß→SS, display "ASS") the
      // display string differs from the source, so this display offset must be
      // reverse-mapped to a STATE offset before it's added to the line/leaf STATE
      // offsets below — otherwise a click inside the "SS" would resolve to an
      // interior offset that splits the ß. `sourceDisplayLengths[i]` is the
      // display-unit count produced by the i-th STATE code unit; `stateOffsetOf`
      // walks it to find the nearest source boundary for a display index. When it
      // is undefined (the common case — 1:1 / untransformed leaves) state offset
      // === display index, so this branch is skipped and `charOffset` is left
      // exactly as `findCharOffset` returned it.
      const displayOffset = findCharOffset(
        targetLeaf.box.text,
        localX,
        targetLeaf.computedStyle,
        measurer,
      );
      const sdl = targetLeaf.box.sourceDisplayLengths;
      charOffset = sdl ? stateOffsetOf(sdl, displayOffset) : displayOffset;
    } else {
      // Inline-block (e.g. a footnote call-marker): one atomic box owning ONE
      // state offset unit (`offsetContribution === 1`). The cursor lands at the
      // LEADING edge (charOffset 0, the position BEFORE the embed) for a click in
      // the box's left half, and the TRAILING edge (charOffset 1, the position
      // AFTER the embed) for a click in the right half — split at the box
      // midpoint, the same nearest-edge rule `findCharOffset` applies to a text
      // glyph. Always-leading (the prior behaviour) made a click anywhere on the
      // marker — including just past it — resolve to the position BEFORE it, so a
      // caret could never be placed after a footnote marker by clicking (and the
      // wrong offset then fed downstream edits). This mirrors `cursor-position`'s
      // inline-block branch, which already maps offset 0 → leading / 1 → trailing.
      const midpoint = targetLeaf.absoluteX + targetLeaf.width / 2;
      charOffset = x >= midpoint ? 1 : 0;
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
 * Find the `PageBox` for `pageIndex` in a positioned layout tree, or `null` for
 * a non-paginated tree (one with no page boxes). The materialized tree is a root
 * `BlockBox` whose children are `PageBox`es; a non-paginated tree has no page at
 * all. Defensively also matches when the root itself is the page, and recurses
 * one level into a non-page container that wraps the pages.
 */
function findPageBox(root: LayoutBox, pageIndex: number): PageBox | null {
  if (root.type === "page") {
    return root.pageIndex === pageIndex ? root : null;
  }
  if (root.type === "block" || root.type === "inline-block") {
    for (const child of root.children) {
      if (child.type === "page" && child.pageIndex === pageIndex) return child;
    }
    // One level deeper, for a wrapper that nests the page list.
    for (const child of root.children) {
      if (child.type === "block" || child.type === "inline-block") {
        for (const grandchild of child.children) {
          if (grandchild.type === "page" && grandchild.pageIndex === pageIndex) {
            return grandchild;
          }
        }
      }
    }
  }
  return null;
}

/**
 * Region-aware zone selection for hit-test step 3 (#331 / #332).
 *
 * Since C.2c T6 a page's flat line list is `[header lines, body lines, footer
 * lines]` in ascending-y order. The nearest-y line pick must run within the
 * click's GEOMETRIC ZONE only, so a click in the body's empty TAIL (below the
 * last body line, above the footer zone) clamps to the BODY rather than walking
 * past it into the footer. Only a click in the footer zone enters the footer,
 * only a click in the header zone enters the header (Google Docs). This is the
 * hit-test sibling of #327's nav/select-all context isolation, with the zone
 * chosen by the click `y` instead of a prior caret context.
 *
 * #332: the zones are the FULL top/bottom page MARGINS, not just the slot text
 * extents. Within a `page` box the line walker resets coordinates to (0,0), so
 * every `absoluteY` here is PAGE-LOCAL and the click `y` is compared in the same
 * frame. The body content area is exactly `[effectiveTopInset, blockSize −
 * effectiveBottomInset]` (read off the PageBox). A click above `contentTop`
 * (anywhere in the top margin, incl. the gap below short header text) → header;
 * at/below `contentBottom` (incl. the gap below short footer text) → footer;
 * in between → body. The earlier version derived the zone boundaries from slot
 * LINE extents, so a click in the top-margin gap below the header text fell
 * through to the body.
 *
 * Classification uses `selectionContextOf`: a MAIN-body line's owner resolves to
 * `state.rootId`; a header/footer/footnote slot line's owner resolves to that
 * slot body's own ROOT id. The header and footnote slots BOTH live in non-root
 * contexts, so they are disambiguated by Y-BAND, not by context kind:
 *   - header band: above `contentTop` (the top margin);
 *   - footer band: at/below `contentBottom` (the bottom margin);
 *   - footnote band (FN-7.2): `[footnoteSlotTop, contentBottom)` — the bottom of
 *     the body content area. The footnote slot SHRINKS the available body space
 *     but does NOT change `effectiveBottomInset`, so its lines sit INSIDE the
 *     content band (below the body content, above the footer). Its top is read
 *     off `PageBox.footnoteSlot.blockOffset`; absent that named slot the page
 *     carries no footnotes and the two-bucket logic runs unchanged.
 * Runs per click/drag (not per keystroke), so the partition is fine.
 */
function pickRegionByBand(
  state: State,
  layoutTree: LayoutBox,
  pageIndex: number,
  visible: readonly AbsoluteLineBox[],
  y: number,
): readonly AbsoluteLineBox[] {
  // 1. Split into body lines (owner context === state.rootId) and slot lines.
  const bodyLines: AbsoluteLineBox[] = [];
  const slotLines: AbsoluteLineBox[] = [];
  for (const l of visible) {
    if (selectionContextOf(state, l.line.ownerBlockId) === state.rootId) {
      bodyLines.push(l);
    } else {
      slotLines.push(l);
    }
  }

  // 2. NO-REGRESSION fast path: no header/footer/footnote slot lines on this
  // page (the overwhelmingly common case). Return `visible` unchanged —
  // byte-identical to the pre-#331 hot path for every slot-free doc.
  if (slotLines.length === 0) return visible;

  // 3. Locate the PageBox to read its content-area edges. If it's missing (a
  // non-paginated tree) or there's no body to clamp to (degenerate), keep prior
  // behavior over the full `visible` list.
  const page = findPageBox(layoutTree, pageIndex);
  if (page === null) return visible;
  if (bodyLines.length === 0) return visible;

  // 4. The body content area (page-local). The full margins outside it are the
  // header (above `contentTop`) / footer (at-or-below `contentBottom`) zones.
  // FN-7.2: the footnote slot, when present, occupies `[footnoteSlotTop,
  // contentBottom)` INSIDE the content area — its top comes from the named
  // `footnoteSlot` box (page-local `blockOffset`; same coordinate frame as the
  // lines' `absoluteY`). Classify slot lines by band: footer (>= contentBottom),
  // footnote (>= footnoteSlotTop && < contentBottom), header (< contentTop). A
  // slot line in `[contentTop, footnoteSlotTop)` (none should occur) lands in no
  // bucket so it can't capture the click.
  const contentTop = page.effectiveTopInset;
  const contentBottom = page.blockSize - page.effectiveBottomInset;
  // `+Infinity` ⇒ no footnote band on this page (no footnote-slot line can match
  // `l.absoluteY >= footnoteSlotTop`), so the classification collapses to the
  // unchanged header/footer two-bucket split.
  const footnoteSlotTop =
    page.footnoteSlot !== null ? page.footnoteSlot.blockOffset : Number.POSITIVE_INFINITY;
  const headerLines: AbsoluteLineBox[] = [];
  const footnoteLines: AbsoluteLineBox[] = [];
  const footerLines: AbsoluteLineBox[] = [];
  for (const l of slotLines) {
    if (l.absoluteY >= contentBottom) {
      footerLines.push(l);
    } else if (l.absoluteY >= footnoteSlotTop) {
      footnoteLines.push(l);
    } else if (l.absoluteY < contentTop) {
      headerLines.push(l);
    }
  }

  // 5. Choose the region by the click `y` against the band edges. Footer wins
  // when the click is at/below `contentBottom`; then the footnote slot when the
  // click is in `[footnoteSlotTop, contentBottom)`; then the header zone above
  // `contentTop`; else the body (which captures the empty body tail above the
  // footnote slot — the #331 clamp). Each branch is gated on having such lines;
  // the fallthrough is `bodyLines`, non-empty here.
  if (footerLines.length > 0 && y >= contentBottom) return footerLines;
  if (footnoteLines.length > 0 && y >= footnoteSlotTop && y < contentBottom) {
    return footnoteLines;
  }
  if (headerLines.length > 0 && y < contentTop) return headerLines;
  return bodyLines;
}

/**
 * Reverse-map a DISPLAY code-unit offset `d` (an index into a text-transformed
 * leaf's display string) to a STATE offset, using the leaf's
 * `sourceDisplayLengths` — the per-state-code-unit display-unit counts (e.g.
 * "aß" uppercased → display "ASS" carries `[1, 2]`).
 *
 * Walks the cumulative display length per state code unit and returns the
 * nearest SOURCE boundary for `d`: an offset that lands exactly on a state
 * boundary maps to that boundary; an interior display offset (one that splits a
 * length-expanding unit like ß→SS) maps to whichever of the two surrounding
 * state boundaries is nearer (ties round to the trailing one), NEVER to an
 * interior offset that would split the source code unit. This is the inverse of
 * `cursor-position.ts`'s state→display prefix sum, so click↔render round-trips.
 */
function stateOffsetOf(sdl: readonly number[], d: number): number {
  let cum = 0;
  for (let o = 0; o < sdl.length; o++) {
    const next = cum + sdl[o];
    if (d <= cum) return o;
    if (d < next) return d - cum < next - d ? o : o + 1; // nearest boundary
    cum = next;
  }
  return sdl.length;
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
