import type { EditorState } from "../editor-state";
import type { Edit } from "../edit";
import { getBlock, mergeBlockAttrs } from "../../state";
import { resolveActiveSection } from "./helpers/resolve-active-section";

/**
 * `TOGGLE_SECTION_LANDSCAPE` handler — toggles the page-geometry override on
 * the SECTION at the cursor between doc-wide and LANDSCAPE (the doc-wide
 * dimensions swapped → wider + shorter pages). This is the editor surface for
 * the per-section page geometry: it only SETS / CLEARS the section
 * block's `attrs.pageInlineSize` / `attrs.pageBlockSize`; the render→layout
 * pipeline already flows those attrs to per-section page geometry.
 *
 * No-ops (return the input `editor` unchanged, never calling `history.commit`):
 *  - `config.pageConfig === undefined` (unpaginated harness): the doc-wide dims
 *    needed to compute the landscape swap are unknown.
 *  - No active section: the caret is outside the main body (a header /
 *    footnote body). Main-body content always sits in a section (the
 *    final section when there is no break).
 *  - The merge is a no-op (`mergeBlockAttrs` returns the same state reference):
 *    the identity guard preserves the "no change → same editor reference"
 *    invariant. (`history.commit` is itself no-op-safe; this guard is about
 *    the identity invariant.)
 *
 * Selection is UNCHANGED: a geometry change does not move the cursor logically.
 */
export function handleToggleSectionLandscape(editor: EditorState): Edit | null {
  const { config } = editor;
  const { pageConfig } = config;
  // Can't determine the landscape (swapped) dimensions without the doc-wide
  // page config.
  if (pageConfig === undefined) return null;

  const sectionId = resolveActiveSection(editor, editor.selection.focus.blockId);
  if (sectionId === null) return null;

  const section = getBlock(editor.document, sectionId);
  if (section === null) return null;

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

  const result = mergeBlockAttrs(editor.document, sectionId, incoming);

  // the identity-no-op contract: a no-op merge returns the same state reference.
  if (result.document === editor.document) return null;

  return { change: { document: result.document, dirtyIds: result.dirtyIds } };
}
