import { resolveBlock, createPosition, selectionContextOf } from "../state";
import type { State, Position } from "../state";
import type { AbsoluteLineBox } from "./line-flatten";
import type { LayoutBox } from "../layout/layout-node";
import type { PageBox } from "../layout/page-box";
import type { TextShaper } from "../layout/text-shaper";
import type { TextMeasurer } from "../layout/text-measurer";
import { isTextShaper, adaptShaperToMeasurer } from "../layout/text-measurer";
import { getLineIndex, coordOf, sizeAlong, lineCoordOf, lineSizeAlong } from "./line-flatten";
import { buildLineBidiView, offsetInLeaf, type CaretAffinity } from "./line-bidi";
import { axisMapFor } from "../styles/writing-mode";
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
 *   3. Pick the line whose BLOCK-axis band `[blockStart, blockStart +
 *      blockExtent]` contains the click's block-axis component, falling
 *      back to the last line for clicks past all content. The block axis is
 *      physical Y for h-tb and physical X for the vertical modes
 *      (`axisMapFor(line.writingMode, line.computedStyle.direction)`,
 *      read per line); `vertical-rl` stacks blocks right→left so the walk
 *      runs in FLOW order (the block coord negated for the reversed axis).
 *      Sub-pixel snap at line boundaries (0.5 px tolerance to the next
 *      line's block-start). h-tb is byte-identical to the old `y <
 *      absoluteY + blockSize` ascending pick.
 *   4. Empty line (no leaf children): return
 *      `Position(line.ownerBlockId, line.inlineOffsetStart)`. No
 *      synthetic-strut fallback needed — the LineBox itself carries
 *      the owning block and the offset.
 *   5. Build the line's `LineBidiView` (P4-C.2). Within the picked
 *      line, walk leaves (text-runs + inline-blocks) in VISUAL order
 *      via `collectLineLeaves`. Pick the leaf whose INLINE-axis range
 *      (`coordOf(leaf, am.inline)` .. `+ sizeAlong(leaf, am.inline)`)
 *      contains the click's inline-axis component — physical X for h-tb,
 *      physical Y for the vertical modes (inline runs down the page) —
 *      falling back to the last leaf for clicks past line end. The view's
 *      `visualLeaves` is in the SAME collection order (ascending along the
 *      inline axis in every mode), so the picked leaf's `BidiViewLeaf`
 *      (carrying its `logStart` and bidi `level`) is
 *      `visualLeaves[targetLeafIdx]`.
 *   6. `offset = offsetInLeaf(thatBidiViewLeaf, clickInline −
 *      coordOf(leaf, am.inline), measurer, am)` (P4-C.2 §C). This is
 *      RTL-aware: an LTR leaf measures the click from its inline-start
 *      edge; an RTL leaf from its inline-end (so a click on the visual-left
 *      of an RTL run resolves to the logically-LAST offset, the OPPOSITE of
 *      LTR). For an inline-block leaf (a 1-unit embed, e.g. a footnote
 *      marker) it splits at the box midpoint — `logStart` (leading, before
 *      the embed) in the first half, `logEnd` (trailing, after it) in the
 *      second. `offsetInLeaf` returns the STATE offset directly (it adds
 *      the leaf's `logStart` and reverse-maps any text-transform display
 *      length internally), so there is NO visual-order accumulation —
 *      the old `withinLineOffset` sum (correct only for an all-LTR line)
 *      is gone. This is the exact inverse of `cursor-position.ts`'s
 *      `caretInlineCoordInLeaf`, so click↔render round-trips on bidi lines.
 *
 * Returns (P4-C.2.2b §D) `{ position, caretAffinity }` — the resolved
 * `Position` plus the caret ASSOCIATION seed for `EditorState.caretAffinity`.
 * The hit LEAF (the leaf whose X range the click landed in) is the authoritative
 * owner of the offset: when the resolved offset is that leaf's TRAILING edge
 * (`logEnd`, and the leaf is non-degenerate so `logEnd !== logStart`) the caret
 * sticks to the PRECEDING leaf → `"before"`; otherwise → `"after"`. A mid-leaf
 * offset is `"after"` (inert — both sides are the same leaf). Empty-line / null
 * paths seed `"after"`. At an LTR↔RTL boundary this records which logical side
 * the click chose so the dual-caret renders on the clicked side.
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
): { position: Position; caretAffinity: CaretAffinity } | null {
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

    // 3. Pick target line by the click's BLOCK-axis component within the chosen
    // band (P3.5b). `region` is in document order, which for h-tb / vertical-lr is
    // ASCENDING along the block axis (physical Y resp. physical X) and for
    // vertical-rl is DESCENDING (blocks stack right→left via the block-axis
    // mirror). We project the click + each line's block band onto the block axis
    // via the line's OWN axis map (a per-line read — a doc could in principle mix
    // modes), then walk in FLOW order (`flowSign` negates the coord for the
    // reversed block axis so the comparison is monotone in document order). For
    // h-tb (`am.block === "y"`, `flowSign === +1`) this is byte-identical to the
    // old `y < absoluteY + blockSize` ascending pick.
    let targetIdx = region.length - 1;
    for (let i = 0; i < region.length; i++) {
      const l = region[i];
      const lAm = axisMapFor(l.line.writingMode, l.line.computedStyle.direction);
      const clickBlock = lAm.block === "x" ? x : y;
      const lineBlockStart = lineCoordOf(l, lAm.block);
      const lineBlockExtent = lineSizeAlong(l, lAm.block);
      const blockReversed = l.line.writingMode === "vertical-rl";
      const flowSign = blockReversed ? -1 : 1;
      // The band edge facing the NEXT document line: the high edge (start +
      // extent) when block flow is ascending, the low edge (start) when reversed.
      const facingEdge = blockReversed ? lineBlockStart : lineBlockStart + lineBlockExtent;
      if (flowSign * clickBlock < flowSign * facingEdge || i === region.length - 1) {
        // Sub-pixel snap: if the click is within 0.5 px of the NEXT line's
        // block-start, prefer the next line. (Layout pixel rounding can place a
        // click exactly on the boundary.) The distance is along the block axis;
        // `Math.abs` makes it direction-agnostic. Read the next line's
        // block-start via its own axis map.
        const next = i + 1 < region.length ? region[i + 1] : undefined;
        if (next !== undefined) {
          const nextAm = axisMapFor(next.line.writingMode, next.line.computedStyle.direction);
          // Snap to the edge of `next` that FACES line `i` (the shared boundary),
          // mode-aware — mirroring the `facingEdge` selection above. For h-tb /
          // vertical-lr (ascending block axis) that is `next`'s low edge
          // (`lineCoordOf`); for vertical-rl (descending block axis) it is
          // `next`'s HIGH edge (start + extent), since `next` sits at a LOWER
          // block coord than line `i`. Using the low edge in v-rl targeted the
          // far edge — one full line-extent away — so the snap never fired.
          const nextReversed = next.line.writingMode === "vertical-rl";
          const nextFacing = nextReversed
            ? lineCoordOf(next, nextAm.block) + lineSizeAlong(next, nextAm.block)
            : lineCoordOf(next, nextAm.block);
          if (Math.abs(clickBlock - nextFacing) < 0.5) {
            targetIdx = i + 1;
          } else {
            targetIdx = i;
          }
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

    // 4-5. Build the line's bidi view. `visualLeaves` is the line's caret-target
    // leaves in COLLECTION (visual, post-reorder) order — the same order the X
    // pick below walks — paired with each leaf's LOGICAL state span (`logStart`/
    // `logEnd`) and UAX #9 bidi `level`. Synthetic struts/hyphens are excluded
    // (they own no state offsets), so an empty line surfaces as `view.isEmpty`.
    const view = buildLineBidiView(targetLine);
    if (view.isEmpty) {
      // Empty line (strut-only). LineBox is first-class — return the
      // line's start offset. No direction boundary here → seed "after".
      return {
        position: createPosition(ownerBlockId, targetLine.line.inlineOffsetStart),
        caretAffinity: "after",
      };
    }
    const visualLeaves = view.visualLeaves;
    // The picked line's axis map (`view.axisMap` == `axisMapFor(line.writingMode,
    // line.computedStyle.direction)`). The leaf pick + offset run along the INLINE
    // axis: physical X for h-tb (`am.inline === "x"`), physical Y for the vertical
    // modes (inline runs DOWN the page). The click's inline-axis component is the
    // matching physical coordinate.
    const am = view.axisMap;
    const clickInline = am.inline === "x" ? x : y;

    // Pick target leaf by VISUAL inline-axis coord (leaves are in visual order;
    // for v-rl inline runs +Y top→bottom, so visual order stays ASCENDING along
    // the inline axis — same ascending assumption this loop has always relied on).
    // Default: last leaf for clicks past end. For h-tb (`am.inline === "x"`,
    // `coordOf(leaf, "x") === leaf.absoluteX`, `sizeAlong(leaf, "x") === leaf.width`)
    // this is byte-identical to the old physical-X pick.
    let targetLeafIdx = visualLeaves.length - 1;
    for (let i = 0; i < visualLeaves.length; i++) {
      const leaf = visualLeaves[i].leaf;
      const leafStart = coordOf(leaf, am.inline);
      if (clickInline < leafStart) {
        targetLeafIdx = i > 0 ? i - 1 : i;
        break;
      }
      if (clickInline < leafStart + sizeAlong(leaf, am.inline)) {
        targetLeafIdx = i;
        break;
      }
    }

    // 6. STATE offset within the target leaf — RTL-aware. `offsetInLeaf` keys off
    // the leaf's bidi `level` (LTR measures the click from the inline-start edge,
    // RTL from the inline-end), reverse-maps any text-transform display length, and
    // adds the leaf's own `logStart`. It returns the absolute STATE offset directly
    // — the inverse of `cursor-position.ts`'s `caretInlineCoordInLeaf` — so NO
    // visual-order accumulation is needed (the old `withinLineOffset` sum, correct
    // only on an all-LTR line, is gone).
    const targetBidiLeaf = visualLeaves[targetLeafIdx];
    // P3.5b: `offsetInLeaf` takes the leaf-local INLINE-axis offset (`clickInline −
    // coordOf(leaf, am.inline)`) + the line's axis map. For h-tb this is
    // `x − leaf.absoluteX` (byte-identical); for vertical it is `y − leaf.absoluteY`.
    const offset = offsetInLeaf(
      targetBidiLeaf,
      clickInline - coordOf(targetBidiLeaf.leaf, am.inline),
      measurer,
      am,
    );

    // Caret-affinity seed (P4-C.2.2b §D): the HIT leaf owns the offset. When the
    // offset is that leaf's TRAILING edge (and the leaf is non-degenerate) the
    // caret sticks to the preceding leaf → "before"; else → "after" (mid-leaf
    // offsets are inert, both sides are the same leaf). At an LTR↔RTL boundary
    // this records the clicked side so the dual-caret renders there.
    const caretAffinity: CaretAffinity =
      offset === targetBidiLeaf.logEnd && offset !== targetBidiLeaf.logStart
        ? "before"
        : "after";

    return { position: createPosition(ownerBlockId, offset), caretAffinity };
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
