import type { EditorState, EditorConfig } from "../editor-state";
import { createPosition, createSpan, spanStart, spanEnd, applyAttrsToRange } from "../../state";
import { isCollapsed } from "../../cursor/selection";
import { rebuildTrees } from "./helpers";

/**
 * Set or clear the font family on the current selection. Used by the toolbar
 * font-family dropdown; can also be dispatched programmatically. A sibling of
 * set-text-color.ts / set-highlight.ts.
 *
 * `family`:
 *   - non-empty string → set `{ fontFamily: family }` on every text item in
 *     the selection. The cascade's `fontFamilyInterpreter` then maps it to
 *     `ComputedStyle.fontFamily`, which the IFC measures each run with (via
 *     the shaper) and the canvas renderer paints with.
 *   - `null` or empty string → clear the fontFamily attr from every text item
 *     in the selection (passes `{ fontFamily: undefined }` to
 *     applyAttrsToRange, which `mergeAttrs` interprets as a removal), so the
 *     glyphs fall back to the inherited/initial font family. An empty family
 *     isn't a meaningful value, so this handler is where we reject it.
 *
 * The cascade is responsible for visual styling; this handler only mutates
 * state.
 *
 * Mirrors set-text-color.ts exactly: collapsed selection short-circuits to a
 * no-op (no font family can be applied to a single cursor position); T7
 * state-equality short-circuit; selection re-built from normalized start/end;
 * dirtyIds threaded through to the incremental render pipeline (per R-D.3).
 */
export function handleSetFontFamily(
  editor: EditorState,
  family: string | null,
  config: EditorConfig,
): EditorState {
  const { selection } = editor;
  if (isCollapsed(selection)) return editor;

  // Normalize empty string to a removal — an empty family isn't a meaningful
  // value, so this handler is where we reject it.
  const incoming = family !== null && family.length > 0
    ? { fontFamily: family }
    : { fontFamily: undefined };
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
