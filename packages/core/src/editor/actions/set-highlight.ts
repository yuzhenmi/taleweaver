import type { EditorState, EditorConfig } from "../editor-state";
import { createPosition, createSpan, spanStart, spanEnd, applyAttrsToRange } from "../../state";
import { isCollapsed } from "../../cursor/selection";
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
 * state-equality short-circuit; selection re-built from normalized start/end;
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
  const result = applyAttrsToRange(editor.state, selection, incoming);
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
