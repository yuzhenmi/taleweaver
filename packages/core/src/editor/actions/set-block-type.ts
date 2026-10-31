import type { EditorState } from "../editor-state";
import type { Edit } from "../edit";
import { getBlock, setBlockType, setBlockAttrs } from "../../state";
import type { BlockId } from "../../state";
import type { ActionOf } from "../editor-action";

export function handleSetBlockType(
  editor: EditorState,
  { blockType, properties = {} }: ActionOf<"SET_BLOCK_TYPE">,
): Edit | null {
  const { config } = editor;
  // Retype the LEAF block containing the cursor,
  // not the outermost ancestor. The pre-fix logic walked UP from the focus
  // block to the document's direct child — vestigial from a pre-nesting
  // document model where every block was a root child. Under the
  // block-tree-of-styled-runs model (2026-05-02 redesign), documents nest:
  // a cursor inside a list-item lives in `document → list → list-item`, so
  // walking-up retyped the LIST instead of the list-item the user is
  // editing. For cursors inside table cells, walked-up retyped the TABLE.
  // Both cross-kind transitions are refused by `setBlockType` (its shape-invariance contract),
  // so the action either threw or silently no-op'd. Google Docs / Word
  // convention: retype the leaf the cursor is actually inside.
  const targetId = editor.selection.focus.blockId;
  const target = getBlock(editor.document, targetId);
  if (target === null) return null;

  // Toggle behavior: if already this type, revert to paragraph.
  const newType = target.type === blockType ? "paragraph" : blockType;
  const newAttrs = target.type === blockType ? {} : properties;

  const typeResult = setBlockType(editor.document, targetId, newType, config.componentRegistry);
  const attrsResult = setBlockAttrs(typeResult.state, targetId, newAttrs);

  // Union dirtyIds across the chained ops so the renderer sees one
  // OperationResult that reflects both mutations.
  const mergedDirtyIds = new Set<BlockId>([
    ...typeResult.dirtyIds,
    ...attrsResult.dirtyIds,
  ]);
  // the identity-no-op contract: state-equality is the authoritative no-op
  // signal across the editor module, preserving the "no change → same
  // editor reference" invariant. (`history.commit` is itself no-op-safe.)
  if (attrsResult.state === editor.document) return null;

  return { change: { state: attrsResult.state, dirtyIds: mergedDirtyIds } };
}
