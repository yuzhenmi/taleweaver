import type { Selection } from "../../state";
import type { EditorState } from "../editor-state";

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
 */
export function handleSetSelection(
  editor: EditorState,
  selection: Selection,
  caretPageHint?: number,
): EditorState {
  return { ...editor, selection, caretPageHint };
}
