import type { BlockId } from "../state";
import { freshState } from "../state";
import { clearTransientViewState, type EditorState } from "./editor-state";
import { applyEdit } from "./edit";

/**
 * Apply a PEER's edit to the local `EditorState` (live collab).
 *
 * When a remote peer mutates the shared `Y.Doc`, the local
 * `subscribeForeignChanges` observer fires with the set of block ids that
 * changed. This function consumes that set to produce the next local
 * `EditorState`:
 *
 * - **`freshState(state, dirtyIds)`** mints a new `Document` over the same Y.Doc
 *   whose snapshot cache is invalidated for `dirtyIds` only. Reads of those
 *   blocks now pick up the live (peer-mutated) Y.Doc; every UNCHANGED block
 *   falls through the overlay to its existing snapshot and stays
 *   reference-equal, so a one-block remote edit doesn't force a full
 *   re-snapshot of a hundred-page document.
 * - **`lastDirtyIds: dirtyIds`** is the layout-driver's incremental hint — the
 *   print backend relayouts only the foreign-dirtied blocks on the next
 *   `update()`, exactly like the post-local-dispatch path.
 *
 * **The selection passes through untouched**, and the change is not a local undo step
 * (the peer owns it): history only follows it, so a later local undo starts from the
 * peer-changed document. Selection rebasing under the remote edit is what the
 * `APPLY_FOREIGN_CHANGE` action adds (`handleApplyForeignChange`).
 *
 * This is an editor-level seam, NOT a controller change: a backend controller
 * that observes a peer's Y.Doc update dispatches `APPLY_FOREIGN_CHANGE` to
 * whichever reducer owns the state: the print host feeds the result back through its controller's
 * `update(editorState)`; the digital controller reduces it in its own `dispatch`.
 * Core is geometry-free, so — like `applyEdit` — this carries no
 * `config`/geometry.
 */
export function reconcileForeignChange(
  editor: EditorState,
  dirtyIds: ReadonlySet<BlockId>,
): EditorState {
  // A foreign edit is a document mutation, so the transient view fields that go
  // stale on any edit must be reset — `clearTransientViewState` is the single home
  // the reducer also routes through (targetX + bidi affinities, all resolved
  // against the pre-edit structure). `caretPageHint` is deliberately NOT in that
  // set: its lifecycle preserves it through non-undo/redo handlers, and a foreign
  // edit is not undo/redo.
  return clearTransientViewState(
    applyEdit(editor, { change: { state: freshState(editor.document, dirtyIds), dirtyIds }, undoable: false }),
  );
}
