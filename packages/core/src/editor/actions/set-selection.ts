import { selectionContextOf, type Selection } from "../../state";
import { isDevMode } from "../../state/dev-mode";
import type { EditorState } from "../editor-state";
import type { ActionOf } from "../editor-action";

/**
 * `SET_SELECTION` handler. Sets the new selection and the non-undoable
 * `caretPageHint` view state in one shot:
 *   - A header/footer SLOT click passes the clicked page → the caret renders on
 *     that page's slot instance.
 *   - A body click (or any single-page selection) passes NO hint → `undefined`
 *     CLEARS any stale slot hint (the caret is back in the body / single-page).
 *
 * Because the value is set here (not centrally cleared in `reduceEditor` the way
 * `targetX` is), passing `undefined` is the explicit clear.
 *
 * `caretAffinity` is the caret ASSOCIATION seed at a bidi
 * direction boundary. UNLIKE `caretPageHint`, this field IS centrally reset in
 * `reduceEditor` via `clearTransientViewState` — which fires after every action
 * EXCEPT `SET_SELECTION` (the sole action that manages it), so it never goes
 * stale. The DOM click seeds the hit side; a programmatic `SET_SELECTION` with no
 * affinity passes `undefined`, which clears it (correct — no boundary context to
 * preserve).
 *
 * `anchorAffinity` is the symmetric ANCHOR-side seed. The
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
export function handleSetSelection(editor: EditorState, action: ActionOf<"SET_SELECTION">): EditorState {
  const { selection } = action;
  // Engine backstop: a Span must keep BOTH endpoints in the SAME
  // selection context (the main document tree, OR one footnote/embed body,
  // OR one header/footer/template body). Cross-context spans are unsupported
  // by the data model — `iterateSpan` throws on them — so storing one here is
  // a latent crash deferred to the first consumer. `SET_SELECTION` is the only
  // reducer arm that accepts an arbitrary externally-supplied span (MOVE_*/
  // EXPAND_*/SELECT_ALL are context-confined by construction), so it is the
  // chokepoint. The DOM controller already guards pointer-drag at the UX
  // layer; this is the caller-agnostic engine guard. Dev-throw (fail fast on
  // the programmer error) + production no-op (keep the prior in-context
  // selection rather than corrupt state), matching the codebase invariant
  // pattern (assertChainIntegrity / requireInTransaction). Root ids are
  // globally unique, so same-context ⇔ equal non-null `selectionContextOf`.
  const anchorCtx = selectionContextOf(editor.state, selection.anchor.blockId);
  const focusCtx = selectionContextOf(editor.state, selection.focus.blockId);
  if (anchorCtx === null || focusCtx === null || anchorCtx !== focusCtx) {
    if (isDevMode()) {
      throw new Error(
        `reduceEditor SET_SELECTION: cross-context selection rejected — anchor ` +
          `block "${selection.anchor.blockId}" (context "${anchorCtx}") and focus ` +
          `block "${selection.focus.blockId}" (context "${focusCtx}") are in ` +
          `different selection contexts; a span must stay within one context.`,
      );
    }
    return editor; // production backstop: no-op, keep the prior in-context selection
  }
  return setSelection(editor, selection, action);
}

/** The view hints a selection change carries (see `handleSetSelection`). */
type SelectionView = Omit<ActionOf<"SET_SELECTION">, "type" | "selection">;

/**
 * `editor` with `selection` and its view hints: an absent `caretPageHint` /
 * `caretAffinity` / `anchorAffinity` clears it, an absent `targetX` leaves it. An edit
 * placing its caret calls this directly (its span is in-context by construction).
 */
export function setSelection(
  editor: EditorState,
  selection: Selection,
  { caretPageHint, caretAffinity, anchorAffinity, targetX }: SelectionView = {},
): EditorState {
  const next: EditorState = { ...editor, selection, caretPageHint, caretAffinity, anchorAffinity };
  return targetX === undefined ? next : { ...next, targetX };
}
