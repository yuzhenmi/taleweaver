import type { EditorState, EditorConfig } from "../editor-state";
import { getBlock, mergeBlockAttrs } from "../../state";
import type { BlockId } from "../../state";
import type { TabStop } from "../../styles/tab-stops";
import { rebuildTrees } from "./helpers";

/**
 * `SET_TAB_STOPS` handler — sets the per-block `tabStops` attr on the target
 * block. The attr flows render → cascade → IFC, which resolves each tab's
 * position-dependent advance against the stop list, so the page reflows.
 *
 * The target block is named explicitly on the action (`action.blockId`) — the
 * host's ruler UI supplies it — rather than derived from the selection, since a
 * tab-stop edit (ruler drag) targets a specific paragraph independent of the
 * caret.
 *
 * The attr is written via `mergeBlockAttrs` (NOT `setBlockAttrs`, which REPLACES
 * all attrs and would wipe `textAlign` / `marginInlineStart` / etc.). Mirrors
 * `handleSetTextAlign`, the canonical single-attr setter: `mergeBlockAttrs` is
 * no-op-safe (a block already carrying the identical stops returns the SAME state
 * reference), so a redundant set is a true no-op.
 *
 * No-op (return the input `editor` unchanged, never calling `history.commit`):
 *  - the target block is not a MAIN-tree block — `getBlock` is used intentionally
 *    (main-tree only): a tab-stop edit (from a future ruler UI) targets a main-body
 *    paragraph, so a `blockId` referring to an embed/template-body block (a footnote,
 *    header, or footer body) is silently refused. (Editing tab stops on a paragraph
 *    inside an embed/template body is a named follow-up alongside the ruler UI.)
 *  - the merge produced no change (identical stops already present) — the
 *    identity guard, mirroring `handleSetTextAlign`.
 *
 * Selection is UNCHANGED: tab stops are a block-geometry change, not a caret move.
 */
export function handleSetTabStops(
  editor: EditorState,
  blockId: BlockId,
  tabStops: readonly TabStop[],
  config: EditorConfig,
): EditorState {
  if (getBlock(editor.state, blockId) === null) return editor;

  const result = mergeBlockAttrs(editor.state, blockId, { tabStops }, config.attrRegistry);
  // No-op merge (identical stops already present): same state ref → return the
  // input editor unchanged so the "no change → same reference" contract holds.
  if (result.state === editor.state) return editor;

  const dirtyIds = new Set<BlockId>(result.dirtyIds);
  editor.history.commit(
    { state: result.state, dirtyIds },
    { before: editor.selection, after: editor.selection },
  );
  return rebuildTrees(
    { ...editor, state: result.state },
    editor,
    config,
    dirtyIds,
  );
}
