import { deleteRange } from "../../../state";
import type { Document, Position, Selection, BlockId } from "../../../state";
import { isCollapsed } from "../../../cursor/selection";
import { isCrossContextSelection } from "./is-cross-context-selection";
import { expandedSpanCollapsePoint } from "./expanded-span-collapse-point";

const EMPTY_DIRTY_IDS: ReadonlySet<BlockId> = new Set();

/** The resolved insertion point for an atomic inline-embed insert. */
export type EmbedInsertPoint =
  | {
      readonly ok: true;
      readonly document: Document;
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
  document: Document,
  selection: Selection,
): EmbedInsertPoint {
  if (isCollapsed(selection)) {
    return { ok: true, document, position: selection.focus, dirtyIds: EMPTY_DIRTY_IDS };
  }
  if (isCrossContextSelection(document, selection)) return { ok: false };
  const collapse = expandedSpanCollapsePoint(document, selection);
  if (collapse === null) return { ok: false };
  const result = deleteRange(document, selection);
  return { ok: true, document: result.document, position: collapse, dirtyIds: result.dirtyIds };
}
