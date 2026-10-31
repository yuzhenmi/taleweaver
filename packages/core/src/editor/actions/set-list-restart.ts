import type { EditorState } from "../editor-state";
import type { Edit } from "../edit";
import { getBlock, setListRestart } from "../../state";
import type { ActionOf } from "../editor-action";

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
  { value }: ActionOf<"SET_LIST_RESTART">,
): Edit | null {
  const blockId = editor.selection.focus.blockId;
  const block = getBlock(editor.document, blockId);
  if (block === null || block.type !== "list-item") return null;

  // `null` clears the override; `mergeAttrs` deletes the key on `undefined`.
  const result = setListRestart(editor.document, blockId, value ?? undefined);
  if (result.document === editor.document) return null;

  return { change: { document: result.document, dirtyIds: result.dirtyIds } };
}
