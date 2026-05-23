import type { EditorState, EditorConfig } from "../editor-state";
import type { BlockId } from "../../state/block-id";
import { getBlock } from "../../state/state";
import { setBlockType } from "../../state/set-block-type";
import { setBlockAttrs } from "../../state/set-block-attrs";
import { rebuildTrees } from "./helpers";

export function handleSetBlockType(
  editor: EditorState,
  blockType: string,
  properties: Record<string, unknown>,
  config: EditorConfig,
): EditorState {
  const focusBlockId = editor.selection.focus.blockId;
  const block = getBlock(editor.state, focusBlockId);
  if (block === null) return editor;

  // Walk up from the leaf to the top-level ancestor (child of root) —
  // the legacy code targeted the document's direct child for retyping.
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

  // Toggle behavior: if already this type, revert to paragraph.
  const newType = target.type === blockType ? "paragraph" : blockType;
  const newAttrs = target.type === blockType ? {} : properties;

  const typeResult = setBlockType(editor.state, targetId, newType, config.componentRegistry);
  const attrsResult = setBlockAttrs(typeResult.state, targetId, newAttrs);

  // Union dirtyIds across the chained ops so the renderer sees one
  // OperationResult that reflects both mutations.
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
