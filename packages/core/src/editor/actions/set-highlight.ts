import type { EditorState, EditorConfig } from "../editor-state";
import { isCollapsed } from "../../cursor/selection";
import { applyAttrsOrSuggest } from "./suggestion-mode";
import { rebuildTrees } from "./helpers";

/**
 * Set or clear the highlight color (text background color) on the current
 * selection. Used by the toolbar highlight picker; can also be dispatched
 * programmatically. The sibling of set-text-color.ts.
 *
 * `color`:
 *   - non-empty string → set `{ backgroundColor }` on every text item in the
 *     selection. The cascade's `backgroundColorInterpreter` then maps it to
 *     `ComputedStyle.backgroundColor`, which the canvas renderer's text-run
 *     branch paints as a rect behind the glyphs.
 *   - `null` or empty string → clear the backgroundColor attr from every text
 *     item in the selection (passes `{ backgroundColor: undefined }` to
 *     applyAttrsToRange, which `mergeAttrs` interprets as a removal), so the
 *     glyphs fall back to the inherited/initial (transparent) background.
 *
 * The cascade is responsible for visual styling; this handler only mutates
 * state.
 *
 * Mirrors set-text-color.ts exactly: collapsed selection short-circuits to a
 * no-op (no highlight can be applied to a single cursor position); T7
 * state-equality short-circuit; the selection is preserved unchanged;
 * dirtyIds threaded through to the incremental render pipeline (per R-D.3).
 */
export function handleSetHighlight(
  editor: EditorState,
  color: string | null,
  config: EditorConfig,
): EditorState {
  const { selection } = editor;
  if (isCollapsed(selection)) return editor;

  // Normalize empty string to a removal — an empty color isn't a meaningful
  // value, so this handler is where we reject it.
  const incoming = color !== null && color.length > 0
    ? { backgroundColor: color }
    : { backgroundColor: undefined };
  const result = applyAttrsOrSuggest(editor.state, selection, incoming, config);
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
