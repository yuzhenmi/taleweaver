import type { EditorState, EditorConfig } from "../editor-state";
import { getBlock, mergeBlockAttrs } from "../../state";
import type { ColumnRule } from "../../styles/column-config";
import { rebuildTrees } from "./helpers";
import { resolveActiveSection } from "./active-section";

/**
 * `SET_SECTION_COLUMNS` handler — sets the multi-column override (Google Docs
 * Format ▸ Columns) on the SECTION at the cursor; when the cursor is in a
 * section-less run (no `SECTION_BREAK` has been made) it applies the override
 * DOC-WIDE by writing the doc-root block's attrs (the doc-root's column
 * metadata becomes `buildSectionPlan`'s `effectiveDefaultColumns`). This is the
 * editor surface for the per-section column geometry: it only SETS the target
 * block's `columnCount` / `columnGap` / `columnRule` attrs; the
 * render→cascade→measure→materialize→paint pipeline already turns those attrs
 * into rendered columns (slices T1–T5).
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
 *    the T7 identity guard preserves the "no change → same editor reference"
 *    invariant. (`history.commit` is itself no-op-safe; this guard is about the
 *    identity invariant.) This covers re-setting the SAME columnCount.
 *
 * Unlike `TOGGLE_SECTION_LANDSCAPE`, columns do NOT depend on the doc-wide page
 * dimensions, so there is no `config.pageConfig === undefined` no-op guard.
 *
 * Selection is UNCHANGED: a column change does not move the cursor logically.
 */
export function handleSetSectionColumns(
  editor: EditorState,
  action: { columnCount: number; columnGap?: number; columnRule?: ColumnRule | null },
  config: EditorConfig,
): EditorState {
  // Target the active SECTION at the cursor, or the doc root when the cursor is
  // in a section-less run (whole-doc columns). The doc-root box's column
  // metadata flows to `buildSectionPlan`'s `effectiveDefaultColumns` (the
  // document component stamps `columnCount`/`columnGap`/`columnRule` onto the
  // cascaded root's metadata, mirroring the section component).
  const targetId =
    resolveActiveSection(editor, editor.selection.focus.blockId) ?? editor.state.rootId;

  const target = getBlock(editor.state, targetId);
  if (target === null) return editor;

  // `columnCount: 1` => single column (NOT a cleared attr); `columnGap` /
  // `columnRule` only when provided, so a bare count change preserves them.
  const incoming: Record<string, unknown> = { columnCount: action.columnCount };
  if (action.columnGap !== undefined) {
    incoming.columnGap = action.columnGap;
  }
  if (action.columnRule !== undefined) {
    incoming.columnRule = action.columnRule;
  }

  const result = mergeBlockAttrs(editor.state, targetId, incoming, config.attrRegistry);

  // T7 identity contract: a no-op merge returns the same state reference.
  if (result.state === editor.state) return editor;

  editor.history.commit(
    { state: result.state, dirtyIds: result.dirtyIds },
    { before: editor.selection, after: editor.selection },
  );
  return rebuildTrees(
    { ...editor, state: result.state },
    editor,
    config,
    result.dirtyIds,
  );
}
