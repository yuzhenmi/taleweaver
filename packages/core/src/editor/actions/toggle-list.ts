import type { EditorState, EditorConfig } from "../editor-state";
import { getBlock, setBlockType, setBlockAttrs } from "../../state";
import type { BlockId } from "../../state";
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
  // E-A13 / 2026-05-23 audit: toggle the LEAF block containing the cursor,
  // not the outermost ancestor. The pre-fix walk-up logic retyped the
  // containing LIST for cursors inside list-items — a cross-kind change
  // (container → leaf) that setBlockType refuses per T11, so the toggle
  // either threw or silently no-op'd. Under the nested document model,
  // toggle-list must operate on the cursor's leaf paragraph/list-item.
  // Google Docs / Word convention: TOGGLE_LIST on a paragraph → list-item;
  // on an existing list-item → paragraph (un-list).
  const targetId = editor.selection.focus.blockId;
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
  // No-op short-circuit: match the codebase pattern (T7 identity
  // contract — state-equality is the authoritative signal, not
  // dirtyIds.size).
  if (attrsResult.state === editor.state) return editor;

  editor.history.commit(
    { state: attrsResult.state, dirtyIds: mergedDirtyIds },
    { before: editor.selection, after: editor.selection },
  );
  return rebuildTrees(
    { ...editor, state: attrsResult.state },
    editor,
    config,
    mergedDirtyIds,
  );
}
