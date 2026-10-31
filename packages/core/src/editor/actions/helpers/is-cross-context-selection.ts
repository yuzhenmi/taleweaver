import { selectionContextOf } from "../../../state";
import type { Document, Span } from "../../../state";

/**
 * Cross-CONTEXT selection predicate.
 *
 * A header/footer body (and a footnote/embed body) is an ISOLATED editing
 * context: its root has `parentId === null` and lives in its own
 * templateContents / embedContents tree, so `selectionContextOf` for one of its
 * blocks returns that body's root rather than the main `state.rootId`.
 *
 * A span whose anchor and focus resolve to DIFFERENT contexts (e.g. main body →
 * header body, constructable via a drag from a header into the body) is
 * UNSUPPORTED by the span ops: `deleteRange` / `replaceRange`'s spanStart would
 * throw "no common ancestor". The edit handlers must REFUSE such a span (no-op)
 * rather than attempt a cross-tree mutation. This is the intentional, uniform
 * signal — independent of the parentId-mismatch guard in
 * `expandedSpanCollapsePoint`, which only happens to catch SOME cross-context
 * cases.
 *
 * Returns `true` when the span straddles two contexts (caller should refuse).
 */
export function isCrossContextSelection(document: Document, span: Span): boolean {
  return (
    selectionContextOf(document, span.anchor.blockId) !==
    selectionContextOf(document, span.focus.blockId)
  );
}
