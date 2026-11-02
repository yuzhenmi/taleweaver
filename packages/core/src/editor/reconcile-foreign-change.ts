import type { BlockId } from "../state";
import { freshDocument } from "../state";
import { clearTransientViewState, type Editor } from "./editor";
import { applyEdit } from "./edit";

/**
 * Apply a PEER's edit to the local `Editor` (live collab).
 *
 * When a remote peer mutates the shared `Y.Doc`, the local
 * `subscribeForeignChanges` observer fires with the set of block ids that
 * changed. This function consumes that set to apply the peer's change to the
 * editor in place:
 *
 * - **`freshDocument(state, dirtyIds)`** mints a new `Document` over the same Y.Doc
 *   whose snapshot cache is invalidated for `dirtyIds` only. Reads of those
 *   blocks now pick up the live (peer-mutated) Y.Doc; every UNCHANGED block
 *   falls through the overlay to its existing snapshot and stays
 *   reference-equal, so a one-block remote edit doesn't force a full
 *   re-snapshot of a hundred-page document.
 * - **`lastDirtyIds: dirtyIds`** is the layout-driver's incremental hint — the
 *   print backend relayouts only the foreign-dirtied blocks when it renders the
 *   change, exactly like the post-local-dispatch path.
 *
 * **The selection passes through untouched**, and the change is not a local undo step
 * (the peer owns it): history only follows it, so a later local undo starts from the
 * peer-changed document. Selection rebasing under the remote edit is what the
 * `APPLY_FOREIGN_CHANGE` action adds (`handleApplyForeignChange`).
 *
 * This is an editor-level seam, NOT a controller change: a backend controller
 * that observes a peer's Y.Doc update dispatches `APPLY_FOREIGN_CHANGE` through
 * `Editor.dispatch`, so the change reaches every subscriber — the print and digital
 * controllers included. Core is geometry-free, so — like `applyEdit` — this carries no
 * `config`/geometry.
 */
export function reconcileForeignChange(
  editor: Editor,
  dirtyIds: ReadonlySet<BlockId>,
): void {
  // A foreign edit is a document mutation, so the transient view fields that go
  // stale on any edit must be reset — `clearTransientViewState` is the single home
  // the reducer also routes through (targetX + bidi affinities, all resolved
  // against the pre-edit structure). `caretPageHint` is deliberately NOT in that
  // set: its lifecycle preserves it through non-undo/redo handlers, and a foreign
  // edit is not undo/redo.
  applyEdit(editor, { change: { document: freshDocument(editor.document, dirtyIds), dirtyIds }, undoable: false });
  clearTransientViewState(editor);
}
