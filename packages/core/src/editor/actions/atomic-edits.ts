import type { EditorState, EditorConfig } from "../editor-state";
import { getBlock, removeBlock, createSpan } from "../../state";
import type { Block, Position } from "../../state";
import { rebuildTrees } from "./helpers";

/**
 * Google-Docs atomic-object deletion at a block boundary (#P11.3). An
 * atomic-leaf block (image / horizontal-line) holds no cursor positions of its
 * own (`inlineContent === null`), so the grapheme-stepping delete handlers walk
 * straight past it and the merge-adjacency guard then fails — leaving Backspace
 * at the start of the block AFTER an atomic block, or Delete at the end of the
 * block BEFORE one, a silent no-op. This restores the expected behavior: the
 * atomic object is removed as a unit, and the caret stays put (it carried no
 * offsets, so the position the caller supplies is unchanged by the removal).
 *
 * `currentBlock` is the block the collapsed caret sits in; `side` selects the
 * neighbour to test — `"backward"` (previous sibling, for Backspace at offset 0)
 * or `"forward"` (next sibling, for Delete at the block end). `caret` is the
 * collapsed position to keep after removal. Returns the updated editor when an
 * adjacent atomic-leaf was removed, or `null` when the neighbour is absent or
 * not an atomic-leaf — the caller then falls through to its normal merge logic.
 *
 * Main-tree only: the neighbour is looked up with `getBlock` (atomic blocks are
 * inserted into the body only — see the INSERT_IMAGE / INSERT_HORIZONTAL_LINE
 * context gate), so a header/footer-body caret never triggers this path.
 */
export function deleteAdjacentAtomicLeaf(
  editor: EditorState,
  config: EditorConfig,
  currentBlock: Block,
  side: "backward" | "forward",
  caret: Position,
): EditorState | null {
  const neighbourId =
    side === "backward" ? currentBlock.prevSiblingId : currentBlock.nextSiblingId;
  if (neighbourId === null) return null;
  const neighbour = getBlock(editor.state, neighbourId);
  if (neighbour === null) return null;
  if (config.componentRegistry.getBlockKind(neighbour.type) !== "atomic-leaf") {
    return null;
  }

  const result = removeBlock(editor.state, neighbourId);
  if (result.state === editor.state) return null;

  const newSelection = createSpan(caret, caret);
  editor.history.commit(result, { before: editor.selection, after: newSelection });
  return rebuildTrees(
    { ...editor, state: result.state, selection: newSelection },
    editor,
    config,
    result.dirtyIds,
  );
}
