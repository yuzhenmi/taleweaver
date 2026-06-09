import type { EditorState, EditorConfig } from "../editor-state";
import { createPosition, createSpan, spanStart, spanEnd } from "../../state";
import { isCollapsed } from "../../cursor/selection";
import { applyAttrsOrSuggest } from "./suggestion-mode";
import { rebuildTrees } from "./helpers";

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
 * Mirrors set-text-color.ts exactly: collapsed selection short-circuits to a
 * no-op (no font size can be applied to a single cursor position); T7
 * state-equality short-circuit; selection re-built from normalized start/end;
 * dirtyIds threaded through to the incremental render pipeline (per R-D.3).
 */
export function handleSetFontSize(
  editor: EditorState,
  size: number | null,
  config: EditorConfig,
): EditorState {
  const { selection } = editor;
  if (isCollapsed(selection)) return editor;

  // Normalize a non-positive size to a removal — a font size of 0 or less
  // isn't a meaningful value, so this handler is where we reject it.
  const incoming = size !== null && size > 0
    ? { fontSize: size }
    : { fontSize: undefined };
  const result = applyAttrsOrSuggest(editor.state, selection, incoming, config);
  if (result.state === editor.state) return editor;

  // Selection invariant under attribute changes — preserve anchor/focus but
  // rebuild span ordering from normalized start/end so consumers see
  // consistent shape.
  const start = spanStart(editor.state, selection);
  const end = spanEnd(editor.state, selection);
  const newSelection = createSpan(
    createPosition(start.blockId, start.offset),
    createPosition(end.blockId, end.offset),
  );

  editor.history.commit(result, {
    before: selection,
    after: newSelection,
  });
  return rebuildTrees(
    { ...editor, state: result.state, selection: newSelection },
    editor,
    config,
    result.dirtyIds,
  );
}
