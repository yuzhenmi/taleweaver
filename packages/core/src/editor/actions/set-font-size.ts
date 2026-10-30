import type { EditorState } from "../editor-state";
import { isCollapsed } from "../../cursor/selection";
import { applyAttrsOrSuggest } from "./helpers/apply-attrs-or-suggest";
import { storeTypingAttrs } from "../typing-attrs";
import type { Edit } from "../edit";
import type { ActionOf } from "../editor-action";

/**
 * Set or clear the font size on the current selection. Used by the toolbar
 * font-size dropdown; can also be dispatched programmatically. A sibling of
 * set-text-color.ts / set-highlight.ts.
 *
 * `size` (px):
 *   - a positive number → set `{ fontSize: size }` on every text item in the
 *     selection. The cascade's `fontSizeInterpreter` then maps it to
 *     `ComputedStyle.fontSize`, which the IFC measures each run at (growing
 *     the line height to the MAX of its runs' block sizes) and the canvas
 *     renderer paints with.
 *   - `null` (or a non-positive number) → clear the fontSize attr from every
 *     text item in the selection (passes `{ fontSize: undefined }` to
 *     applyAttrsToRange, which `mergeAttrs` interprets as a removal), so the
 *     glyphs fall back to the inherited/initial font size. A non-positive size
 *     isn't a meaningful value, so this handler is where we reject it.
 *
 * The cascade is responsible for visual styling; this handler only mutates
 * state.
 *
 * Mirrors set-text-color.ts exactly:
 * a collapsed caret records the value as pending typing attrs (`storeTypingAttrs`)
 * for the next typed text — the document is unchanged; a
 * state-equality short-circuit; the selection is preserved unchanged;
 * dirtyIds threaded through to the incremental render pipeline.
 */
export function handleSetFontSize(editor: EditorState, { size }: ActionOf<"SET_FONT_SIZE">): Edit | null {
  const { selection } = editor;
  // Normalize a non-positive size to a removal — a font size of 0 or less
  // isn't a meaningful value, so this handler is where we reject it.
  const incoming = size !== null && size > 0
    ? { fontSize: size }
    : { fontSize: undefined };
  // Collapsed caret: the size applies to the next typed text (typing attrs).
  if (isCollapsed(selection)) return storeTypingAttrs(editor, incoming);
  const result = applyAttrsOrSuggest(editor, selection, incoming);
  if (result.state === editor.state) return null;

  // An attr-only edit shifts no offsets, so the selection is unchanged — it is
  // committed and rebuilt AS-IS, preserving both endpoints and the anchor/focus
  // DIRECTION (a backward drag-selection stays backward — Google-Docs parity).
  // Normalizing via spanStart/spanEnd would silently flip a backward selection
  // to forward, so a following Shift+Arrow would extend from the wrong end.
  return { change: result };
}
