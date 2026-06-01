import type { EditorState, EditorConfig } from "../editor-state";
import { createPosition, createSpan, spanStart, spanEnd, applyAttrsToRange } from "../../state";
import { isCollapsed } from "../../cursor/selection";
import { rebuildTrees } from "./helpers";

/**
 * Set or clear a hyperlink on the current selection. Used by HL.4's
 * Cmd+K popup; can also be dispatched programmatically.
 *
 * `url`:
 *   - non-empty string → set `{ link: url }` on every text item in
 *     the selection. The cascade's `linkInterpreter` then renders
 *     each affected item as blue + underlined.
 *   - `null` or empty string → clear the link attr from every text
 *     item in the selection (passes `{ link: undefined }` to
 *     applyAttrsToRange, which `mergeAttrs` interprets as a removal).
 *
 * The cascade is responsible for visual styling; this handler only
 * mutates state. Click handling (Cmd/Ctrl-click to open the URL)
 * lives in the DOM editor controller (HL.3).
 *
 * Mirrors the toggle-style.ts shape: collapsed selection short-
 * circuits to a no-op (no link can be applied to a single cursor
 * position); T7 state-equality short-circuit; selection re-built
 * from normalized start/end; dirtyIds threaded through to the
 * incremental render pipeline (per R-D.3).
 */
export function handleSetLink(
  editor: EditorState,
  url: string | null,
  config: EditorConfig,
): EditorState {
  const { selection } = editor;
  if (isCollapsed(selection)) return editor;

  // Normalize empty string to a removal — UX rule: an empty URL
  // isn't a meaningful link. Per the HL.1 test note, the cascade
  // interpreter would still apply link styling for an empty string,
  // so this handler is where we reject it.
  const incoming = url !== null && url.length > 0
    ? { link: url }
    : { link: undefined };
  const result = applyAttrsToRange(editor.state, selection, incoming);
  if (result.state === editor.state) return editor;

  // Selection invariant under attribute changes — preserve
  // anchor/focus but rebuild span ordering from normalized
  // start/end so consumers see consistent shape.
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
