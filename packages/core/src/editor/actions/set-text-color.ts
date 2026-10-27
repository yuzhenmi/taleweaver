import type { EditorState, EditorConfig } from "../editor-state";
import { isCollapsed } from "../../cursor/selection";
import { applyAttrsOrSuggest } from "./suggestion-mode";
import { rebuildTrees } from "./helpers";
import { storeTypingAttrs } from "../typing-attrs";

/**
 * Set or clear the text color on the current selection. Used by the
 * toolbar color picker; can also be dispatched programmatically.
 *
 * `color`:
 *   - non-empty string → set `{ color }` on every text item in the
 *     selection. The cascade's `colorInterpreter` then maps it to
 *     `ComputedStyle.color`, which the canvas renderer uses as the
 *     glyph `fillStyle`.
 *   - `null` or empty string → clear the color attr from every text
 *     item in the selection (passes `{ color: undefined }` to
 *     applyAttrsToRange, which `mergeAttrs` interprets as a removal),
 *     so the glyphs fall back to the inherited/initial color.
 *
 * The cascade is responsible for visual styling; this handler only
 * mutates state.
 *
 * Shape:
 * a collapsed caret records the value as pending typing attrs (`storeTypingAttrs`)
 * for the next typed text — the document is unchanged; T7
 * state-equality short-circuit; the selection is preserved unchanged;
 * dirtyIds threaded through to the incremental render pipeline (per R-D.3).
 */
export function handleSetTextColor(
  editor: EditorState,
  color: string | null,
  config: EditorConfig,
): EditorState {
  const { selection } = editor;
  // Normalize empty string to a removal — an empty color isn't a
  // meaningful value, so this handler is where we reject it.
  const incoming = color !== null && color.length > 0
    ? { color }
    : { color: undefined };
  // Collapsed caret: the color applies to the next typed text (typing attrs).
  if (isCollapsed(selection)) return storeTypingAttrs(editor, incoming, config.attrRegistry);
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
