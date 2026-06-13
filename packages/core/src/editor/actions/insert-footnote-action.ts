import type { EditorState, EditorConfig } from "../editor-state";
import {
  insertFootnote,
  productionAllocator,
  selectionContextOf,
  createPosition,
  createSpan,
} from "../../state";
import { rebuildTrees } from "./helpers";
import { prepareEmbedInsertPoint } from "./selection-guards";
import type { BlockId } from "../../state";

/**
 * `INSERT_FOOTNOTE` handler — the FN-7 user-insert vehicle, mirroring the
 * INSERT_HEADER/FOOTER slice.
 *
 * Splices a `footnote-anchor` EmbedItem at the caret (`selection.focus`),
 * atomically creates the footnote body (a `footnote-body` CONTAINER root holding
 * one empty paragraph) in `embedContents`, and places a collapsed caret at the
 * start of that paragraph so the user can immediately type. The
 * create→caret→type chain (plus delete-cascade and derived renumbering) is what
 * makes the whole footnote slice exercisable.
 *
 * **Nested-footnote guard (Google Docs: footnotes only in body text).** A
 * footnote may not be inserted while the caret is inside a header / footer /
 * footnote body. We detect that by `selectionContextOf(state, focus.blockId)`:
 * a block in the main document (including one inside a `display:contents`
 * section) resolves UP to `state.rootId`, while a block inside a template body
 * or an embed body resolves to that body's own `parentId: null` root — a
 * non-root context. When the focus is in a non-root context we return the
 * editor UNCHANGED (no anchor, no state change). We read `focus` (the active
 * end), not `anchor`.
 *
 * NOT idempotent (unlike headers/footers): every call inserts a NEW anchor +
 * body. Selection-after: a collapsed caret at the body's first paragraph child,
 * `{ firstParagraphId, 0 }`.
 *
 * **Non-collapsed selection** is REPLACED, not preserved: `prepareEmbedInsertPoint`
 * deletes the selected range first (folding its dirtyIds into the single commit
 * so delete+insert is one undo step) and returns the collapse point where the
 * anchor is spliced — matching INSERT_TEXT / PASTE / Google Docs. A
 * cross-context / cross-parent span is un-deletable → no-op.
 */
export function handleInsertFootnote(
  editor: EditorState,
  config: EditorConfig,
): EditorState {
  const focus = editor.selection.focus;

  // Refuse a footnote inside a footnote / header / footer body — only main
  // document body text (which resolves to `state.rootId`) may carry an anchor.
  if (selectionContextOf(editor.state, focus.blockId) !== editor.state.rootId) {
    return editor;
  }

  // Delete a non-collapsed selection first (Google Docs replaces the selection
  // when you insert a footnote), then splice the anchor at the collapse point. A
  // cross-context / cross-parent expanded selection is un-deletable → no-op.
  const prep = prepareEmbedInsertPoint(editor.state, editor.selection);
  if (!prep.ok) return editor;

  const result = insertFootnote(prep.state, prep.position, productionAllocator);
  // Identity invariant: nothing changed (no delete AND a no-op insert) → return
  // the editor unchanged so the "no change → same reference" contract holds.
  if (result.state === prep.state && prep.dirtyIds.size === 0) return editor;
  const dirtyIds = new Set<BlockId>(prep.dirtyIds);
  for (const id of result.dirtyIds) dirtyIds.add(id);

  const cursor = createPosition(result.firstParagraphId, 0);
  const selectionAfter = createSpan(cursor, cursor);

  editor.history.commit(
    { state: result.state, dirtyIds },
    { before: editor.selection, after: selectionAfter },
  );
  return rebuildTrees(
    { ...editor, state: result.state, selection: selectionAfter },
    editor,
    config,
    dirtyIds,
  );
}
