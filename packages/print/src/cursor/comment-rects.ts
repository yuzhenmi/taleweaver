import { resolveCommentRange, createSpan } from "@taleweaver/core";
import type { State, CommentId } from "@taleweaver/core";
import type { LayoutBox } from "../layout/layout-node";
import type { TextShaper } from "@taleweaver/core";
import type { SelectionRect } from "./selection-geometry";
import { computeSelectionRects } from "./selection-geometry";

/**
 * Compute the pixel highlight rectangles for a comment's range — the host-facing
 * query that turns an anchored comment into the geometry it needs to position a
 * margin thread-anchor indicator and drive the in-text highlight overlay (slice
 * 5). Returns one `SelectionRect` per line the range covers (multi-line and
 * multi-page ranges yield several rects); an empty array when the comment has no
 * paintable range.
 *
 * Algorithm (design §5):
 *   1. Resolve the comment's range via {@link resolveCommentRange} (a single
 *      content scan over the paired `comment-start`/`comment-end` marker embeds).
 *   2. An ABSENT comment (`range === null` — both markers deleted) or an
 *      ORPHANED comment (`range.orphaned` — markers one-sided / inverted /
 *      duplicated, i.e. no well-formed live pair) has nothing to highlight →
 *      return `[]`.
 *   3. Otherwise build a span from the two marker positions and delegate to
 *      {@link computeSelectionRects}, the established selection-geometry path.
 *
 * The markers are ZERO-WIDTH inline-block atoms, so `createSpan(range.start,
 * range.end)` highlights EXACTLY the text between them: the `comment-start`
 * marker's leading edge coincides with the first highlighted glyph's left edge,
 * the `comment-end` marker's leading edge with the last glyph's right edge. No
 * ±1 offset adjustment is applied (or needed).
 *
 * This lives in `cursor/` (not `state/`) because it needs the laid-out
 * `layoutTree` and a `TextShaper` to resolve positions to pixels. Geometry is
 * re-resolved from the FRESH layout tree on every call — the find-match Stage-1
 * cadence: the host re-queries after each layout cycle rather than maintaining a
 * separate cached-rect invalidation path.
 *
 * NOTE: this is the STANDALONE (non-paginated / external-host) query, taking a
 * single positioned `LayoutBox`. The bundled DOM host does NOT call it — under
 * the virtualized layout it has no whole-document `LayoutBox`, so its overlay
 * resolves highlights PER PAGE in the controller (`resolveCommentHighlights` /
 * `commentHighlightsForPage` → `resolveCommentRange` + `computeSelectionRectsForPage`).
 * Both paths share `resolveCommentRange` + the selection-geometry core, so they
 * agree; this helper serves a host that already has a flat positioned tree.
 *
 * @param state      Current document state.
 * @param layoutTree The materialized layout tree to resolve positions against.
 * @param shaper     Text shaper for sub-leaf pixel measurement.
 * @param commentId  The (branded) id of the comment to highlight.
 * @returns One `SelectionRect` per covered line, or `[]` when the comment is
 *   absent or orphaned.
 */
export function getCommentRangeRects(
  state: State,
  layoutTree: LayoutBox,
  shaper: TextShaper,
  commentId: CommentId,
): SelectionRect[] {
  const range = resolveCommentRange(state, commentId);
  if (range === null || range.orphaned) return [];

  return computeSelectionRects(
    state,
    createSpan(range.start, range.end),
    layoutTree,
    shaper,
  );
}
