import type { EditorState } from "../editor-state";
import type { Edit } from "../edit";
import { getBlock, mergeBlockAttrs } from "../../state";
import { resolveActiveSection } from "./active-section";
import type { ActionOf } from "../editor-action";

/**
 * `SET_SECTION_COLUMNS` handler — sets the multi-column override (Google Docs
 * Format ▸ Columns) on the SECTION at the cursor (there is always a
 * section — the final one holds a break-less document). This is the
 * editor surface for the per-section column geometry: it only SETS the target
 * block's `columnCount` / `columnGap` / `columnRule` attrs; the
 * render→cascade→measure→materialize→paint pipeline already turns those attrs
 * into rendered columns.
 *
 * `columnCount: 1` is the SINGLE-COLUMN state — it sets `columnCount: 1`
 * (matching `DEFAULT_COLUMN_CONFIG.columnCount`), which `resolveColumnConfig`
 * yields as single-column and `columnConfigsEqual` keeps INERT against the
 * doc-default (no `columnConfig` boundary stamp). It does NOT clear the attr to
 * `undefined`: an explicit `columnCount: 1` on a section that inherits a
 * doc-wide multicol default must FORCE single-column there, which a cleared
 * attr (falling back to the default) would not do.
 *
 * `columnGap` / `columnRule` are written ONLY when the action provides them, so
 * a bare `columnCount` change does not clobber an existing gap / rule.
 *
 * No-ops (return the input `editor` unchanged, never calling `history.commit`):
 *  - The merge is a no-op (`mergeBlockAttrs` returns the same state reference):
 *    the identity guard preserves the "no change → same editor reference"
 *    invariant. (`history.commit` is itself no-op-safe; this guard is about the
 *    identity invariant.) This covers re-setting the SAME columnCount.
 *
 * Unlike `TOGGLE_SECTION_LANDSCAPE`, columns do NOT depend on the doc-wide page
 * dimensions, so there is no `config.pageConfig === undefined` no-op guard.
 *
 * Selection is UNCHANGED: a column change does not move the cursor logically.
 */
export function handleSetSectionColumns(editor: EditorState, action: ActionOf<"SET_SECTION_COLUMNS">): Edit | null {
  // Target the active SECTION at the cursor (main-body content always
  // sits in a section — the final one when there is no break). A caret outside the
  // main body has none: no-op.
  const targetId = resolveActiveSection(editor, editor.selection.focus.blockId);
  if (targetId === null) return null;

  const target = getBlock(editor.state, targetId);
  if (target === null) return null;

  // `columnCount: 1` => single column (NOT a cleared attr); `columnGap` /
  // `columnRule` only when provided, so a bare count change preserves them.
  const incoming: Record<string, unknown> = { columnCount: action.columnCount };
  if (action.columnGap !== undefined) {
    incoming.columnGap = action.columnGap;
  }
  if (action.columnRule !== undefined) {
    incoming.columnRule = action.columnRule;
  }

  const result = mergeBlockAttrs(editor.state, targetId, incoming);

  // the identity-no-op contract: a no-op merge returns the same state reference.
  if (result.state === editor.state) return null;

  return { change: { state: result.state, dirtyIds: result.dirtyIds } };
}
