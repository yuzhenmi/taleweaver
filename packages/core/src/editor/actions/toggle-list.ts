import type { EditorState, EditorConfig } from "../editor-state";
import type { BlockId } from "../../state/block-id";
import { getBlock } from "../../state/state";
import { setBlockType } from "../../state/set-block-type";
import { setBlockAttrs } from "../../state/set-block-attrs";
import { rebuildTrees } from "./helpers";

/**
 * Toggle list-item on the block containing the cursor.
 *
 * Simplified algorithm vs. legacy wrap/unwrap-in-list:
 *   - If the focus block is already a list-item, revert to paragraph.
 *   - Else, set the focus block's type to "list-item" with attrs
 *     `{ listType }`.
 *
 * The legacy code wrapped the paragraph in a list container. P11-cutover
 * relies on the renderer being able to render list-items directly; the
 * list-container wrap is a follow-up.
 */
export function handleToggleList(
  editor: EditorState,
  listType: "ordered" | "unordered",
  config: EditorConfig,
): EditorState {
  const focusBlockId = editor.selection.focus.blockId;
  const block = getBlock(editor.state, focusBlockId);
  if (block === null) return editor;

  // Walk up to the top-level ancestor (child of root).
  let targetId = focusBlockId;
  let cur = block;
  while (cur.parentId !== null && cur.parentId !== editor.state.rootId) {
    targetId = cur.parentId;
    const parent = getBlock(editor.state, cur.parentId);
    if (parent === null) break;
    cur = parent;
  }
  const target = getBlock(editor.state, targetId);
  if (target === null) return editor;

  const isListItem = target.type === "list-item";
  const typeResult = setBlockType(
    editor.state,
    targetId,
    isListItem ? "paragraph" : "list-item",
    config.componentRegistry,
  );
  const attrsResult = setBlockAttrs(
    typeResult.state,
    targetId,
    isListItem ? {} : { listType },
  );

  // Union dirtyIds across the chained ops.
  const mergedDirtyIds = new Set<BlockId>([
    ...typeResult.dirtyIds,
    ...attrsResult.dirtyIds,
  ]);
  if (mergedDirtyIds.size === 0) return editor;

  editor.history.commit(
    { state: attrsResult.state, dirtyIds: mergedDirtyIds },
    { before: editor.selection, after: editor.selection },
  );
  return rebuildTrees(
    { ...editor, state: attrsResult.state },
    editor,
    config,
  );
}
