import type { EditorState, EditorConfig } from "../editor-state";
import { createSpan, spanStart, spanEnd } from "../../state";
import { moveToLine } from "../../cursor/line-navigation";
import { isCollapsed } from "../../cursor/selection";

export function handleMoveLine(
  editor: EditorState,
  direction: "up" | "down",
  config: EditorConfig,
): EditorState {
  const { selection } = editor;

  // If selection is expanded, collapse to appropriate end then move to adjacent line.
  const moveFocus = isCollapsed(selection)
    ? selection.focus
    : direction === "up"
      ? spanStart(editor.state, selection)
      : spanEnd(editor.state, selection);

  const result = moveToLine(
    editor.state,
    moveFocus,
    editor.layoutTree,
    config.measurer,
    direction,
    editor.targetX,
    // #323/C1: keep a header/footer caret on the page it's editing.
    editor.caretPageHint,
  );
  if (result === null) return editor;
  return {
    ...editor,
    selection: createSpan(result.position, result.position),
    targetX: result.targetX,
    // #500: seed the affinity the line-move resolved (from the hit-test at the
    // target line). At a soft-wrap / column boundary the landed offset is shared
    // between two visual lines, and only this affinity pins the caret to the line
    // the move stepped onto — without it the caret renders with the default
    // ("after") and an ArrowUp at the top of a column appears to do nothing.
    // MOVE_LINE is exempted from the central caret-affinity reset via
    // `actionManagesCaretAffinity` so this survives to the next render.
    caretAffinity: result.caretAffinity,
    // #503: MOVE_LINE COLLAPSES the selection (anchor === focus), so the
    // ANCHOR has no bidi-boundary context. It is exempted from the central
    // `anchorAffinity` reset (it's in `actionManagesAnchorAffinity`), so clear
    // explicitly — otherwise the `...editor` spread would carry a stale value
    // (mirrors move-cursor / move-line-boundary). Uniform invariant: every
    // collapsing action clears `anchorAffinity`.
    anchorAffinity: undefined,
  };
}
