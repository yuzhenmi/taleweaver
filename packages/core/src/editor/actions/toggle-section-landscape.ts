import type { EditorState, EditorConfig } from "../editor-state";
import { getBlock, mergeBlockAttrs } from "../../state";
import { rebuildTrees } from "./helpers";
import { resolveActiveSection } from "./active-section";

/**
 * `TOGGLE_SECTION_LANDSCAPE` handler — toggles the page-geometry override on
 * the SECTION at the cursor between doc-wide and LANDSCAPE (the doc-wide
 * dimensions swapped → wider + shorter pages). This is the editor surface for
 * the per-section page geometry (C.2b-2): it only SETS / CLEARS the section
 * block's `attrs.pageInlineSize` / `attrs.pageBlockSize`; the render→layout
 * pipeline already flows those attrs to per-section page geometry.
 *
 * No-ops (return the input `editor` unchanged, never calling `history.commit`):
 *  - `config.pageConfig === undefined` (unpaginated harness): the doc-wide dims
 *    needed to compute the landscape swap are unknown.
 *  - No active section: the cursor is in a bare doc-root document (no
 *    SECTION_BREAK has been made), so the doc-root child the focus sits under
 *    is not a `section`.
 *  - The merge is a no-op (`mergeBlockAttrs` returns the same state reference):
 *    the T7 identity guard preserves the "no change → same editor reference"
 *    invariant. (`history.commit` is itself no-op-safe; this guard is about
 *    the identity invariant.)
 *
 * Selection is UNCHANGED: a geometry change does not move the cursor logically.
 */
export function handleToggleSectionLandscape(
  editor: EditorState,
  config: EditorConfig,
): EditorState {
  const { pageConfig } = config;
  // Can't determine the landscape (swapped) dimensions without the doc-wide
  // page config.
  if (pageConfig === undefined) return editor;

  const sectionId = resolveActiveSection(editor, editor.selection.focus.blockId);
  if (sectionId === null) return editor;

  const section = getBlock(editor.state, sectionId);
  if (section === null) return editor;

  // "Currently landscape" iff the section carries a numeric inline-size
  // override. Toggling clears it (falls back to doc-wide); otherwise set the
  // doc-wide dimensions SWAPPED.
  const currentlyLandscape = typeof section.attrs.pageInlineSize === "number";
  const incoming = currentlyLandscape
    ? { pageInlineSize: undefined, pageBlockSize: undefined }
    : {
        pageInlineSize: pageConfig.pageBlockSize,
        pageBlockSize: pageConfig.pageInlineSize,
      };

  const result = mergeBlockAttrs(editor.state, sectionId, incoming, config.attrRegistry);

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
