import {
  resolveBlock,
  spanStart,
  selectionContextOf,
  deleteRange,
} from "../../state";
import type { State, Span, Position, Selection, BlockId } from "../../state";
import { isCollapsed } from "../../cursor/selection";

/**
 * C.2c §6: cross-CONTEXT selection predicate.
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
export function isCrossContextSelection(state: State, span: Span): boolean {
  return (
    selectionContextOf(state, span.anchor.blockId) !==
    selectionContextOf(state, span.focus.blockId)
  );
}

/**
 * Resolve the collapse point for an expanded (non-collapsed) selection that is
 * about to be deleted/replaced, applying the deletable-span guard shared by
 * DELETE_BACKWARD, DELETE_FORWARD, and SPLIT_NODE.
 *
 * Returns `spanStart(state, span)` — the position the caret collapses to after
 * the delete — when the span is deletable, or `null` when the caller must
 * REFUSE (no-op).
 *
 * The span is refused when:
 *   - either endpoint's block does not resolve, OR
 *   - the endpoints live in different blocks AND those blocks have different
 *     parents (a cross-parent span — `deleteRange` throws on it).
 *
 * `resolveBlock` (main → embed → template) is used so a header/footer caret
 * resolves; for a main-tree id the behavior is byte-identical (resolveBlock's
 * first arm is `getBlock`). T7a / render precedent.
 *
 * NOTE: the cross-CONTEXT guard (`isCrossContextSelection`) is SEPARATE and
 * must be checked first at each call site — it catches cross-tree spans whose
 * blocks would otherwise both resolve here. Keeping the two distinct preserves
 * each guard's rationale and the exact refusal order (both just `return
 * editor`, so the order is not observable).
 */
export function expandedSpanCollapsePoint(
  state: State,
  span: Span,
): Position | null {
  const anchorBlock = resolveBlock(state, span.anchor.blockId)?.block ?? null;
  const focusBlock = resolveBlock(state, span.focus.blockId)?.block ?? null;
  if (anchorBlock === null || focusBlock === null) return null;
  // deleteRange throws on cross-parent — refuse with no-op if so.
  if (
    span.anchor.blockId !== span.focus.blockId &&
    anchorBlock.parentId !== focusBlock.parentId
  ) {
    return null;
  }
  return spanStart(state, span);
}

const EMPTY_DIRTY_IDS: ReadonlySet<BlockId> = new Set();

/** The resolved insertion point for an atomic inline-embed insert. */
export type EmbedInsertPoint =
  | {
      readonly ok: true;
      readonly state: State;
      readonly position: Position;
      readonly dirtyIds: ReadonlySet<BlockId>;
    }
  | { readonly ok: false };

/**
 * Resolve where to splice an atomic inline-embed field (footnote, cross-
 * reference), DELETING a non-collapsed selection first. Google Docs replaces the
 * selection when you insert such a field — the same delete-then-insert shape as
 * INSERT_TEXT / PASTE — so an insert handler must not silently leave the selected
 * range intact and append the field at the focus end.
 *
 *  - Collapsed selection → the focus position, state unchanged, no dirty blocks.
 *  - Expanded + deletable (single context, deletable span — the two existing
 *    guards) → `deleteRange`, then the span-start collapse point + the delete's
 *    dirtyIds, which the caller folds into the single commit so the
 *    delete+insert is ONE undo step.
 *  - Expanded + cross-context or cross-parent (un-deletable as one span) →
 *    `{ ok: false }`; the caller returns the editor unchanged.
 */
export function prepareEmbedInsertPoint(
  state: State,
  selection: Selection,
): EmbedInsertPoint {
  if (isCollapsed(selection)) {
    return { ok: true, state, position: selection.focus, dirtyIds: EMPTY_DIRTY_IDS };
  }
  if (isCrossContextSelection(state, selection)) return { ok: false };
  const collapse = expandedSpanCollapsePoint(state, selection);
  if (collapse === null) return { ok: false };
  const result = deleteRange(state, selection);
  return { ok: true, state: result.state, position: collapse, dirtyIds: result.dirtyIds };
}
