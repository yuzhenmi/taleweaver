import type { BlockId } from "../state";
import { freshState } from "../state";
import { clearTransientViewState, type EditorState } from "./editor-state";

/**
 * Apply a PEER's edit to the local `EditorState` (live-collab P1).
 *
 * When a remote peer mutates the shared `Y.Doc`, the local
 * `subscribeForeignChanges` observer fires with the set of block ids that
 * changed. This function consumes that set to produce the next local
 * `EditorState`:
 *
 * - **`freshState(state, dirtyIds)`** mints a new `State` over the same Y.Doc
 *   whose snapshot cache is invalidated for `dirtyIds` only. Reads of those
 *   blocks now pick up the live (peer-mutated) Y.Doc; every UNCHANGED block
 *   falls through the overlay to its existing snapshot and stays
 *   reference-equal, so a one-block remote edit doesn't force a full
 *   re-snapshot of a hundred-page document.
 * - **`lastDirtyIds: dirtyIds`** is the layout-driver's incremental hint — the
 *   print backend relayouts only the foreign-dirtied blocks on the next
 *   `update()`, exactly like the post-local-dispatch path.
 *
 * **Selection and history pass through untouched.** A foreign edit is not in
 * the local undo history (the peer owns it), and selection rebasing under a
 * concurrent remote edit is a deferred rough edge (the eventual fix is Yjs
 * `RelativePosition`). The local caret keeps its `Position`; only a peer
 * editing the SAME block the caret sits in can drift it.
 *
 * This is an editor-level seam, NOT a controller change: the print controller
 * is a fed-`editorState` renderer, so the host (React hook) calls this and
 * feeds the result back through the controller's normal `update(editorState)`
 * path. Core is geometry-free (Phase 0b), so — like `rebuildTrees` — this
 * carries no `config`/geometry.
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
  return clearTransientViewState({
    ...editor,
    state: freshState(editor.state, dirtyIds),
    lastDirtyIds: dirtyIds,
  });
}
