import type { EditorState, EditorConfig } from "../editor-state";
import { getBlock, setListRestart } from "../../state";
import { rebuildTrees } from "./helpers";

/**
 * SET_LIST_RESTART — set or clear the focused list-item's per-item counter
 * override (Google Docs' "restart numbering at N" / "continue previous
 * numbering"). A number forces the item's value (and following items in the run
 * renumber from it); `null` clears the override so the item resumes the natural
 * sequence.
 *
 * Targets the focus block; a no-op (caret not in a list-item, or the override is
 * already the requested value) returns the same `editor` reference. The op's
 * dirtyIds carry only the changed item — the following items renumber via the
 * render pass's counter-diff (the same incremental-renumber path the list
 * collector drives), so no extra dirty ids are needed here.
 */
export function handleSetListRestart(
  editor: EditorState,
  value: number | null,
  config: EditorConfig,
): EditorState {
  const blockId = editor.selection.focus.blockId;
  const block = getBlock(editor.state, blockId);
  if (block === null || block.type !== "list-item") return editor;

  // `null` clears the override; `mergeAttrs` deletes the key on `undefined`.
  const result = setListRestart(editor.state, blockId, value ?? undefined);
  if (result.state === editor.state) return editor;

  editor.history.commit(
    { state: result.state, dirtyIds: result.dirtyIds },
    { before: editor.selection, after: editor.selection },
  );
  return rebuildTrees(
    { ...editor, state: result.state },
    editor,
    config,
    result.dirtyIds,
  );
}
