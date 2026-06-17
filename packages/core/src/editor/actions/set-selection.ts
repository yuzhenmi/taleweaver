import type { Selection } from "../../state";
import type { EditorState } from "../editor-state";
import type { CaretAffinity } from "../../cursor/selection";

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
 * `reduceEditor` via `clearTransientViewState` — which fires after every action
 * EXCEPT `SET_SELECTION` (the sole action that manages it), so it never goes
 * stale. The DOM click seeds the hit side; a programmatic `SET_SELECTION` with no
 * affinity passes `undefined`, which clears it (correct — no boundary context to
 * preserve).
 *
 * `anchorAffinity` (#503) is the symmetric ANCHOR-side seed. Post-Phase-0b the
 * backend NavIntent resolver ORIGINATES affinity (the line/expand handlers that
 * used to seed it moved out of core), so `SET_SELECTION` now ACCEPTS AND STORES
 * the passed `anchorAffinity` as-given (a programmatic / body `SET_SELECTION`
 * passes `undefined`, which clears it — no boundary context to preserve).
 *
 * `targetX` is the line-navigation sticky goal-column. The backend computes a
 * line-move's `targetX` and threads it here; `SET_SELECTION` STORES it as-given
 * (passing `undefined` leaves the prior value, which the central `targetX` clear
 * in `reduceEditor` — exempting `SET_SELECTION` — then preserves; passing `null`
 * clears it, matching every non-line nav). A plain click / programmatic select
 * passes no `targetX`, so the field is untouched here and cleared centrally.
 */
export function handleSetSelection(
  editor: EditorState,
  selection: Selection,
  caretPageHint?: number,
  caretAffinity?: CaretAffinity,
  anchorAffinity?: CaretAffinity,
  targetX?: number | null,
): EditorState {
  const next: EditorState = { ...editor, selection, caretPageHint, caretAffinity, anchorAffinity };
  return targetX === undefined ? next : { ...next, targetX };
}
