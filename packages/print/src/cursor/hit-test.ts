import { resolveBlock, createPosition, selectionContextOf } from "@taleweaver/core";
import type { State, Position, BlockKindResolver } from "@taleweaver/core";
import { getAtomicBoxIndex } from "./atomic-box-index";
import type { AbsoluteLineBox } from "./line-flatten";
import type { LayoutBox } from "../layout/layout-node";
import type { PageBox } from "../layout/page-box";
import type { TextShaper } from "@taleweaver/core";
import type { TextMeasurer } from "@taleweaver/core";
import { isTextShaper, adaptShaperToMeasurer } from "@taleweaver/core";
import { getLineIndex, coordOf, sizeAlong, lineCoordOf, lineSizeAlong } from "./line-flatten";
import { locateTableCellAtPoint } from "../layout/table-cell-at-point";
import { locateColumnAtPoint } from "../layout/column-at-point";
import { buildLineBidiView, offsetInLeaf, type CaretAffinity } from "./line-bidi";
import { axisMapFor } from "@taleweaver/core";
import type { AxisMap } from "@taleweaver/core";
import { apply } from "@taleweaver/core";
import { markStart, markEnd } from "@taleweaver/core";

/**
 * POSITIONING slice 5 — map a click point `(x, y)` into a LINE's PRE-transform
 * coordinate space via its baked three-state `inverseTransform`:
 *   - `undefined` → no transform in the line's ancestor chain → IDENTITY: the
 *     click is returned verbatim (the 99% zero-overhead fast path).
 *   - a `Mat2D` → an invertible cumulative transform → the click is mapped through
 *     the inverse so the line's PRE-transform bounds test correctly
 *     (point-in-transformed-quad ≡ inverse-point-in-pretransform-rect).
 *   - `"singular"` → a degenerate (zero-area / invisible) transform → returns
 *     `null` so the caller SKIPS the line (it can never own the click).
 */
function mapClickForLine(
  line: AbsoluteLineBox,
  x: number,
  y: number,
): { readonly x: number; readonly y: number } | null {
  const inv = line.inverseTransform;
  if (inv === undefined) return { x, y };
  if (inv === "singular") return null;
  return apply(inv, x, y);
}

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
  resolver?: BlockKindResolver,
): { position: Position; caretAffinity: CaretAffinity } | null {
  const t = markStart("cursor.hit-test");
  try {
    const measurer: TextMeasurer = isTextShaper(shaperOrMeasurer)
      ? adaptShaperToMeasurer(shaperOrMeasurer)
      : shaperOrMeasurer;

    // 0. Object-selection pre-pass (#525). When a `resolver` is provided, a click
    // INSIDE an atomic-leaf block's rect (image / horizontal-line) selects that
    // block AS AN OBJECT — the collapsed-on-atomic position `{blockId, 0}` —
    // taking priority over the LineBox text fall-through below. Atomic leaves
    // render as a `BlockBox` with NO `LineBox`, so without this a click on an
    // image resolves to the nearest text caret. The index rects are built with
    // the same physical `(parentX/parentY)` accumulation as the line walk, so the
    // click `(x, y)` (document-relative within the clicked page) is in the SAME
    // frame as each `AbsoluteRect` — no coordinate adjustment needed. We filter to
    // the click's page so a multi-page tree only point-tests THIS page's atomics.
    // A hit inside an atomic rect WINS; a click OUTSIDE every atomic rect falls
    // through to the existing line logic (so a click in wrapped text BESIDE a
    // floated image still gives a text position). When `resolver` is ABSENT the
    // pre-pass is skipped entirely → behavior is UNCHANGED for every existing
    // caller. Half-open `[rect.x, rect.x + width)` / `[rect.y, rect.y + height)`
    // matches the line band/leaf picks' half-open convention.
    if (resolver !== undefined) {
      const atomicIndex = getAtomicBoxIndex(layoutTree, resolver, state);
      for (const [blockId, rect] of atomicIndex) {
        if (rect.pageIndex !== pageIndex) continue;
        if (
          x >= rect.x &&
          x < rect.x + rect.width &&
          y >= rect.y &&
          y < rect.y + rect.height
        ) {
          return { position: createPosition(blockId, 0), caretAffinity: "after" };
        }
      }
    }

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
    const bandRegion = pickRegionByBand(state, layoutTree, pageIndex, visible, x, y);

    // 2c. Table-cell restriction (P8.S4b). The flat band-pick below is column-
    // UNAWARE — it picks the first line whose block-axis band contains the click,
    // ignoring the inline axis until the in-line leaf pick. In a multi-column row
    // every cell's line shares the block band, so a click in column B would resolve
    // into column A (and a click in a rowSpan cell's lower region into the wrong
    // row's cell). When the click lands in a table cell, restrict the candidate
    // lines to that cell's physical rect first, so the band+leaf pick runs WITHIN
    // the owning cell. `locateTableCellAtPoint` resolves the cell (incl. spanning
    // cells) in the same page-local coordinate space the lines carry. An empty cell
    // (no lines inside) falls back to the unrestricted region.
    let region = bandRegion;

    // 2c-i. Multi-column restriction (slice 3a). The band-pick in step 3 is
    // inline-axis-UNAWARE, so for N side-by-side columns sharing a block band a
    // click in column B (right) would resolve into column A's (left) line.
    // Restrict the candidate lines to the clicked column's PHYSICAL rect FIRST —
    // exactly like the table-cell restriction below. `locateColumnAtPoint` returns
    // `null` for a single-column page (no `MultiColumnBox`) ⇒ region unchanged, so
    // single-column hit-testing is completely unaffected. An empty column (no
    // lines inside) also falls back to the unrestricted region. The table-cell
    // restriction below then composes WITHIN the column (a table nested in a
    // column resolves correctly) because it filters the already-narrowed `region`.
    const locatedCol = locateColumnAtPoint(layoutTree, x, y, pageIndex);
    if (locatedCol !== null) {
      const { column, absX, absY } = locatedCol;
      const inColumn = region.filter(
        (l) =>
          l.absoluteX >= absX && l.absoluteX < absX + column.width &&
          l.absoluteY >= absY && l.absoluteY < absY + column.height,
      );
      if (inColumn.length > 0) region = inColumn;
    }

    const located = locateTableCellAtPoint(layoutTree, x, y, pageIndex);
    if (located !== null) {
      const { cell, absX, absY } = located;
      const inCell = region.filter(
        (l) =>
          l.absoluteX >= absX && l.absoluteX < absX + cell.width &&
          l.absoluteY >= absY && l.absoluteY < absY + cell.height,
      );
      if (inCell.length > 0) region = inCell;
    }

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
      if (l === undefined) {
        throw new Error(`hit-test: region[${i}] missing (unreachable)`);
      }
      // POSITIONING slice 5 — map the click into THIS line's PRE-transform space
      // through its baked three-state `inverseTransform`. `undefined` → identity
      // (no transform anywhere in the chain → the click is used verbatim, the 99%
      // zero-overhead fast path). A `Mat2D` → the click is inverse-mapped so the
      // pre-transform line bounds below test correctly (point-in-transformed-quad ≡
      // inverse-point-in-pretransform-rect). `"singular"` → the line is zero-area /
      // invisible → SKIP it (it can never own the click).
      const mapped = mapClickForLine(l, x, y);
      if (mapped === null) continue;
      const lAm = axisMapFor(l.line.writingMode, l.line.computedStyle.direction);
      const clickBlock = lAm.block === "x" ? mapped.x : mapped.y;
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
    if (targetLine === undefined) {
      throw new Error(`hit-test: region[${targetIdx}] missing (unreachable — region non-empty)`);
    }
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
    // POSITIONING slice 5 — the leaf pick + offset run in the target line's
    // PRE-transform space, so map the click through the line's `inverseTransform`
    // first. `undefined` → identity (the click is used verbatim, the 99% path). A
    // singular last-line fallback (mapped === null) cannot resolve a real offset →
    // use the raw click defensively (the band loop already skips singular lines, so
    // this only triggers for the degenerate all-singular region edge case).
    // NOTE (transform v1 asymmetry — named follow-up, see 1.9-positioning.md):
    // hit-test (click→offset) IS transform-corrected here via the per-line inverse,
    // but the COMPLEMENTARY path — cursor-position (offset→caret pixel) and
    // selection-geometry rects — still returns PRE-transform coordinates in v1. So a
    // click inside a transformed box resolves to the right offset, yet the caret for
    // that offset may render at the un-transformed position. Resolving both reuses the
    // same per-line `Mat2D` (forward) and is deferred with the selection-rect follow-up.
    const targetClick = mapClickForLine(targetLine, x, y) ?? { x, y };
    const clickInline = am.inline === "x" ? targetClick.x : targetClick.y;

    // Pick target leaf by VISUAL inline-axis coord (leaves are in visual order;
    // for v-rl inline runs +Y top→bottom, so visual order stays ASCENDING along
    // the inline axis — same ascending assumption this loop has always relied on).
    // Default: last leaf for clicks past end. For h-tb (`am.inline === "x"`,
    // `coordOf(leaf, "x") === leaf.absoluteX`, `sizeAlong(leaf, "x") === leaf.width`)
    // this is byte-identical to the old physical-X pick.
    let targetLeafIdx = visualLeaves.length - 1;
    for (let i = 0; i < visualLeaves.length; i++) {
      const vl = visualLeaves[i];
      if (vl === undefined) {
        throw new Error(`hit-test: visualLeaves[${i}] missing (unreachable)`);
      }
      const leaf = vl.leaf;
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
    if (targetBidiLeaf === undefined) {
      throw new Error(
        `hit-test: visualLeaves[${targetLeafIdx}] missing (unreachable — non-empty view)`,
      );
    }
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
 * every line coord here is PAGE-LOCAL and the click is compared in the same
 * frame. The body content area is exactly `[effectiveTopInset, blockSize −
 * effectiveBottomInset]` (read off the PageBox). A click above `contentTop`
 * (anywhere in the top margin, incl. the gap below short header text) → header;
 * at/below `contentBottom` (incl. the gap below short footer text) → footer;
 * in between → body. The earlier version derived the zone boundaries from slot
 * LINE extents, so a click in the top-margin gap below the header text fell
 * through to the body.
 *
 * P3 (#438): the zone edges (`contentTop`/`contentBottom`/`footnoteSlotTop`) are
 * LOGICAL BLOCK-AXIS quantities (insets/`blockSize`/`blockOffset` are all
 * block-axis). For h-tb the block axis IS physical Y, so a line's `absoluteY` and
 * the click `y` ARE logical block offsets and the comparisons work directly. For
 * the vertical modes the block axis is physical X, and `vertical-rl` MIRRORS it
 * against the page block-size (P3.1). Rather than hand-flip the comparison
 * directions per mode (the error-prone path), we project each slot line's
 * physical block coord AND the click's physical block component back to LOGICAL
 * block-offset space (un-mirroring vertical-rl against the SAME `page.blockSize`
 * the physicalize pass mirrored against), then run the EXISTING zone comparisons
 * unchanged — they are already written in logical-block-offset terms. For h-tb
 * the projection reduces to the identity (`logicalBlockOffsetOf(l) ===
 * lineCoordOf(l, "y") === l.absoluteY`, `logicalClickBlock === y`), so the
 * function is byte-identical for every horizontal doc.
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
  x: number,
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

  // 3b. Project physical block coords → LOGICAL block-offset space (#438). The
  // zone edges below (`contentTop`/`contentBottom`/`footnoteSlotTop`) are all
  // LOGICAL block-axis quantities. For h-tb the block axis is physical Y, so a
  // line's `absoluteY` and the click `y` ARE logical block offsets and the
  // projection is the identity. For the vertical modes the block axis is physical
  // X; `vertical-rl` additionally MIRRORS it against the page block-size (P3.1).
  // We un-mirror against the SAME `page.blockSize` the physicalize pass mirrored
  // against, so the zone comparisons can run UNCHANGED. We discriminate the
  // descending (mirrored) block axis ONLY by `vertical-rl` (vertical-lr's block
  // axis ascends along physical X, same as h-tb along Y).
  const pageAm: AxisMap = axisMapFor(page.writingMode, page.direction);
  const pageBlockSize = page.blockSize;
  const blockReversed = page.writingMode === "vertical-rl";
  // A LINE's logical block-START offset. ASCENDING: the physical block-start
  // coord IS the logical offset. DESCENDING (vertical-rl): the logical-start
  // edge is at the HIGH physical coord, so it is `pageBlockSize − physicalEnd`
  // (physicalEnd = physical block-start + physical block-extent).
  const lineLogicalBlockOffset = (l: AbsoluteLineBox): number => {
    const physStart = lineCoordOf(l, pageAm.block);
    if (!blockReversed) return physStart;
    return pageBlockSize - (physStart + lineSizeAlong(l, pageAm.block));
  };
  // The click POINT's physical block component (size 0). DESCENDING: a point's
  // logical offset is `pageBlockSize − physicalCoord`.
  const clickBlockPhys = pageAm.block === "x" ? x : y;
  const clickLogicalBlock = blockReversed
    ? pageBlockSize - clickBlockPhys
    : clickBlockPhys;

  // 4. The body content area (logical block-offset space). The full margins
  // outside it are the header (above `contentTop`) / footer (at-or-below
  // `contentBottom`) zones. FN-7.2: the footnote slot, when present, occupies
  // `[footnoteSlotTop, contentBottom)` INSIDE the content area — its top comes
  // from the named `footnoteSlot` box (`blockOffset` is ALREADY a logical
  // block-offset). Classify slot lines by band: footer (>= contentBottom),
  // footnote (>= footnoteSlotTop && < contentBottom), header (< contentTop). A
  // slot line in `[contentTop, footnoteSlotTop)` (none should occur) lands in no
  // bucket so it can't capture the click.
  const contentTop = page.effectiveTopInset;
  const contentBottom = page.blockSize - page.effectiveBottomInset;
  // `+Infinity` ⇒ no footnote band on this page (no footnote-slot line can match
  // `logicalBlockOffsetOf(l) >= footnoteSlotTop`), so the classification
  // collapses to the unchanged header/footer two-bucket split.
  const footnoteSlotTop =
    page.footnoteSlot !== null ? page.footnoteSlot.blockOffset : Number.POSITIVE_INFINITY;
  const headerLines: AbsoluteLineBox[] = [];
  const footnoteLines: AbsoluteLineBox[] = [];
  const footerLines: AbsoluteLineBox[] = [];
  for (const l of slotLines) {
    const lBlock = lineLogicalBlockOffset(l);
    if (lBlock >= contentBottom) {
      footerLines.push(l);
    } else if (lBlock >= footnoteSlotTop) {
      footnoteLines.push(l);
    } else if (lBlock < contentTop) {
      headerLines.push(l);
    }
  }

  // 5. Choose the region by the click's LOGICAL block offset against the band
  // edges. Footer wins when the click is at/below `contentBottom`; then the
  // footnote slot when the click is in `[footnoteSlotTop, contentBottom)`; then
  // the header zone above `contentTop`; else the body (which captures the empty
  // body tail above the footnote slot — the #331 clamp). Each branch is gated on
  // having such lines; the fallthrough is `bodyLines`, non-empty here.
  if (footerLines.length > 0 && clickLogicalBlock >= contentBottom) return footerLines;
  if (
    footnoteLines.length > 0 &&
    clickLogicalBlock >= footnoteSlotTop &&
    clickLogicalBlock < contentBottom
  ) {
    return footnoteLines;
  }
  if (headerLines.length > 0 && clickLogicalBlock < contentTop) return headerLines;
  return bodyLines;
}
