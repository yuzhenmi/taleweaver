import type { EditorState, EditorConfig } from "../editor-state";
import { setBlockType, mergeBlockAttrs } from "../../state";
import type { Block, BlockId } from "../../state";
import { rebuildTrees } from "./helpers";

/**
 * The nesting level of a `list-item` block (0–8). A missing / non-numeric /
 * non-positive `listLevel` attr is level 0 (the top of the list). Shared by the
 * LIST_INDENT/OUTDENT handler and the Enter/Backspace list-exit logic so the
 * "what level is this item" rule lives in one place.
 */
export function listLevelOf(block: Block): number {
  const raw = block.attrs.listLevel;
  return typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : 0;
}

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
): EditorState {
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
    config.attrRegistry,
  );
  if (attrResult.state === editor.state) return editor;

  const dirtyIds = new Set<BlockId>([
    ...typeResult.dirtyIds,
    ...attrResult.dirtyIds,
  ]);
  editor.history.commit(
    { state: attrResult.state, dirtyIds },
    { before: editor.selection, after: editor.selection },
  );
  return rebuildTrees({ ...editor, state: attrResult.state }, editor, config, dirtyIds);
}
