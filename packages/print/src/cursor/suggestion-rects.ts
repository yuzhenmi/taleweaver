import { resolveSuggestionRange, createSpan } from "@taleweaver/core";
import type { State, SuggestionId } from "@taleweaver/core";
import type { LayoutBox } from "../layout/layout-node";
import type { TextShaper } from "@taleweaver/core";
import type { SelectionRect } from "./selection-geometry";
import { computeSelectionRects } from "./selection-geometry";
import { getBoundaryMarkIndex } from "./boundary-mark-index";

/**
 * Compute the pixel highlight rectangles for a tracked-change suggestion's range
 * — the host-facing query that turns a pending
 * suggestion into the geometry a suggestion sidebar needs to draw a hover/focus
 * highlight over the affected text. Returns one `SelectionRect` per line the
 * range covers (multi-line and multi-page ranges yield several rects); an empty
 * array when the suggestion has no paintable range.
 *
 * Algorithm (mirror of {@link getCommentRangeRects}):
 *   1. Resolve the suggestion's range via {@link resolveSuggestionRange} — the
 *      `[min(start), max(end)]` span over every item tagged with the id (a
 *      paragraph / section boundary suggestion: `[(L, len), (R, 0)]`).
 *   2. An ABSENT suggestion (`range === null` — no tagged item survives, e.g. the
 *      record exists but its runs were all removed) has nothing to highlight →
 *      return `[]`. (Unlike comments there is no separate `orphaned` state — the
 *      range index simply omits an id with no live tagged content.)
 *   3. Otherwise delegate the resolved span to {@link computeSelectionRects}, the
 *      established selection-geometry path, and add the rect of every boundary ¶
 *      glyph whose mark names the suggestion and that no span rect already covers.
 *
 * This lives in `cursor/` (not `state/`) because it needs the laid-out
 * `layoutTree` and a `TextShaper` to resolve positions to pixels. Geometry is
 * re-resolved from the FRESH layout tree on every call — the find-match / comment
 * Stage-1 cadence: the host re-queries after each layout cycle rather than
 * maintaining a separate cached-rect invalidation path.
 *
 * @param state        Current document state.
 * @param layoutTree   The materialized layout tree to resolve positions against.
 * @param shaper       Text shaper for sub-leaf pixel measurement.
 * @param suggestionId The (branded) id of the suggestion to highlight.
 * @returns One `SelectionRect` per covered line, or `[]` when the suggestion has
 *   no live tagged content.
 */
export function getSuggestionRangeRects(
  state: State,
  layoutTree: LayoutBox,
  shaper: TextShaper,
  suggestionId: SuggestionId,
): SelectionRect[] {
  const range = resolveSuggestionRange(state, suggestionId);
  if (range === null) return [];

  const rects = computeSelectionRects(
    state,
    createSpan(range.start, range.end),
    layoutTree,
    shaper,
  );
  // A paragraph / section boundary suggestion covers no character: its visible
  // extent is the ¶ glyph of every block whose boundary mark names it — unless the
  // span's own newline extension already covers that glyph.
  const covers = (r: SelectionRect, m: SelectionRect): boolean =>
    r.pageIndex === m.pageIndex && r.x <= m.x && r.y <= m.y && r.x + r.width >= m.x + m.width && r.y + r.height >= m.y + m.height;
  for (const m of getBoundaryMarkIndex(layoutTree)) {
    if (!m.box.boundaryMark.mark.suggestionIds.includes(suggestionId)) continue;
    const rect = { x: m.x, y: m.y, width: m.width, height: m.height, pageIndex: m.pageIndex };
    if (!rects.some((r) => covers(r, rect))) rects.push(rect);
  }
  return rects;
}
