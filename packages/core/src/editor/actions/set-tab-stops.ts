import type { EditorState } from "../editor-state";
import type { Edit } from "../edit";
import { getBlock, mergeBlockAttrs } from "../../state";
import type { BlockId } from "../../state";
import type { ActionOf } from "../editor-action";

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
 *    header, or footer body) is silently refused — tab stops inside an
 *    embed/template body cannot be set through this action.
 *  - the merge produced no change (identical stops already present) — the
 *    identity guard, mirroring `handleSetTextAlign`.
 *
 * Selection is UNCHANGED: tab stops are a block-geometry change, not a caret move.
 */
export function handleSetTabStops(
  editor: EditorState,
  { blockId, tabStops }: ActionOf<"SET_TAB_STOPS">,
): Edit | null {
  if (getBlock(editor.document, blockId) === null) return null;

  const result = mergeBlockAttrs(editor.document, blockId, { tabStops });
  // No-op merge (identical stops already present): same state ref → return the
  // input editor unchanged so the "no change → same reference" contract holds.
  if (result.state === editor.document) return null;

  const dirtyIds = new Set<BlockId>(result.dirtyIds);
  return { change: { state: result.state, dirtyIds } };
}
