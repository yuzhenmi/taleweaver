import type { EditorState } from "../../editor-state";
import type { Edit } from "../../edit";
import type { EditorConfig } from "../../editor-config";
import { setBlockType, mergeBlockAttrs } from "../../../state";
import type { Block, BlockId } from "../../../state";

/**
 * Remove a `list-item`'s list membership: convert it back to a `paragraph` and
 * clear `listId`/`listLevel`/`listCounterOverride`. The block keeps its id and
 * inlineContent (so the caret stays put), matching Google Docs — pressing Enter
 * in an empty top-level item, or Backspace at the start of a top-level item,
 * drops the bullet/number and leaves a normal paragraph.
 *
 * A no-op (the block already carries none of those attrs and is a paragraph)
 * returns the same `editor` reference without committing.
 */
export function unlistBlock(
  editor: EditorState,
  block: Block,
  config: EditorConfig,
): Edit | null {
  const typeResult = setBlockType(
    editor.state,
    block.id,
    "paragraph",
    config.componentRegistry,
  );
  const attrResult = mergeBlockAttrs(
    typeResult.state,
    block.id,
    { listId: undefined, listLevel: undefined, listCounterOverride: undefined },
  );
  if (attrResult.state === editor.state) return null;

  const dirtyIds = new Set<BlockId>([
    ...typeResult.dirtyIds,
    ...attrResult.dirtyIds,
  ]);
  return { change: { state: attrResult.state, dirtyIds } };
}
