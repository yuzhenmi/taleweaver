import type { EditorState, EditorConfig } from "../editor-state";
import { isCollapsed } from "../../cursor/selection";
import { INLINE_FORMAT_ATTR_KEYS } from "../inline-format-keys";
import { applyAttrsOrSuggest } from "./suggestion-mode";
import { rebuildTrees } from "./helpers";

/**
 * Clear all inline (character-level) formatting from the current selection —
 * Google Docs' "Clear formatting" (Ctrl+\). Removes EVERY attr in
 * `INLINE_FORMAT_ATTR_KEYS` (bold/italic/underline/strikethrough, color,
 * backgroundColor, fontSize, fontFamily, link) from every text item in the
 * selection in one atomic op, so a single undo brings them all back.
 *
 * Scope is CHARACTER formatting only — block-level attrs (block type,
 * alignment, textIndent, lineHeight) are deliberately untouched.
 *
 * The cascade is responsible for visual styling; this handler only mutates
 * state.
 *
 * Mirrors set-text-color.ts exactly, but instead of setting one attr it sets
 * EVERY inline-format key to `undefined` (which `mergeAttrs` interprets as a
 * removal). Collapsed selection short-circuits to a no-op (nothing to clear at
 * a single cursor position); the T7 state-equality short-circuit also covers an
 * already-clean selection (no attrs removed → no state change → no history
 * entry). The selection is preserved unchanged; dirtyIds threaded
 * through to the incremental render pipeline (per R-D.3).
 */
export function handleClearFormatting(
  editor: EditorState,
  config: EditorConfig,
): EditorState {
  const { selection } = editor;
  if (isCollapsed(selection)) return editor;

  // One object mapping every inline-format key to `undefined` — a single
  // applyAttrsOrSuggest call removes them all atomically (one undo step) in
  // direct mode, or suggests their removal as ONE formatting record (the
  // clear-all delta is a valid `proposedAttrs`) in suggesting mode.
  const incoming: Record<string, undefined> = {};
  for (const key of INLINE_FORMAT_ATTR_KEYS) {
    incoming[key] = undefined;
  }
  const result = applyAttrsOrSuggest(editor.state, selection, incoming, config);
  // No attr was actually present to remove → no state change → no-op
  // (also short-circuits an already-clean selection, no history entry).
  if (result.state === editor.state) return editor;

  // An attr-only edit shifts no offsets, so the selection is unchanged — it is
  // committed and rebuilt AS-IS, preserving both endpoints and the anchor/focus
  // DIRECTION (a backward drag-selection stays backward — Google-Docs parity).
  // Normalizing via spanStart/spanEnd would silently flip a backward selection
  // to forward, so a following Shift+Arrow would extend from the wrong end.
  editor.history.commit(result, {
    before: selection,
    after: selection,
  });
  return rebuildTrees(
    { ...editor, state: result.state, selection },
    editor,
    config,
    result.dirtyIds,
  );
}
