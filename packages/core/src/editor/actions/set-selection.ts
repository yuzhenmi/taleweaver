import type { Selection } from "../../state";
import type { EditorState } from "../editor-state";
import type { CaretAffinity } from "../../cursor/line-bidi";

/**
 * `SET_SELECTION` handler. Sets the new selection and the (#323) non-undoable
 * `caretPageHint` view state in one shot:
 *   - A header/footer SLOT click passes the clicked page → the caret renders on
 *     that page's slot instance.
 *   - A body click (or any single-page selection) passes NO hint → `undefined`
 *     CLEARS any stale slot hint (the caret is back in the body / single-page).
 *
 * Because the value is set here (not centrally cleared in `reduceEditor` the way
 * `targetX` is), passing `undefined` is the explicit clear.
 *
 * `caretAffinity` (P4-C.2.2b §D) is the caret ASSOCIATION seed at a bidi
 * direction boundary. UNLIKE `caretPageHint`, this field IS centrally reset in
 * `reduceEditor` (the `actionManagesCaretAffinity` predicate keeps it ONLY
 * across the actions that set it — `SET_SELECTION` is one). The DOM click seeds
 * the hit side; a programmatic `SET_SELECTION` with no affinity passes
 * `undefined`, which clears it (correct — no boundary context to preserve).
 */
export function handleSetSelection(
  editor: EditorState,
  selection: Selection,
  caretPageHint?: number,
  caretAffinity?: CaretAffinity,
): EditorState {
  return { ...editor, selection, caretPageHint, caretAffinity };
}
