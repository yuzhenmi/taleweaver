import type { EditorState, EditorConfig } from "../editor-state";
import { getBlock, setBlockType, setBlockAttrs } from "../../state";
import type { BlockId } from "../../state";
import { rebuildTrees } from "./helpers";

export function handleSetBlockType(
  editor: EditorState,
  blockType: string,
  properties: Record<string, unknown>,
  config: EditorConfig,
): EditorState {
  // E-A13 / 2026-05-23 audit: retype the LEAF block containing the cursor,
  // not the outermost ancestor. The pre-fix logic walked UP from the focus
  // block to the document's direct child — vestigial from a pre-nesting
  // document model where every block was a root child. Under the
  // block-tree-of-styled-runs model (2026-05-02 redesign), documents nest:
  // a cursor inside a list-item lives in `document → list → list-item`, so
  // walking-up retyped the LIST instead of the list-item the user is
  // editing. For cursors inside table cells, walked-up retyped the TABLE.
  // Both cross-kind transitions are refused by `setBlockType` per T11,
  // so the action either threw or silently no-op'd. Google Docs / Word
  // convention: retype the leaf the cursor is actually inside.
  const targetId = editor.selection.focus.blockId;
  const target = getBlock(editor.state, targetId);
  if (target === null) return editor;

  // Toggle behavior: if already this type, revert to paragraph.
  const newType = target.type === blockType ? "paragraph" : blockType;
  const newAttrs = target.type === blockType ? {} : properties;

  const typeResult = setBlockType(editor.state, targetId, newType, config.componentRegistry);
  const attrsResult = setBlockAttrs(typeResult.state, targetId, newAttrs, config.attrRegistry);

  // Union dirtyIds across the chained ops so the renderer sees one
  // OperationResult that reflects both mutations.
  const mergedDirtyIds = new Set<BlockId>([
    ...typeResult.dirtyIds,
    ...attrsResult.dirtyIds,
  ]);
  // T7 identity contract: state-equality is the authoritative no-op
  // signal across the editor module, preserving the "no change → same
  // editor reference" invariant. (`history.commit` is itself no-op-safe.)
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
