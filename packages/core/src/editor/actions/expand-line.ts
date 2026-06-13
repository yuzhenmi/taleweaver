import type { EditorState, EditorConfig } from "../editor-state";
import { seedAnchorAffinity } from "../editor-state";
import { createSpan } from "../../state";
import { moveToLine } from "../../cursor/line-navigation";

export function handleExpandLine(
  editor: EditorState,
  direction: "up" | "down",
  config: EditorConfig,
): EditorState {
  // #503: seed/persist `anchorAffinity` BEFORE mutating the selection (the seed
  // reads the still-collapsed span). A selection STARTED with Shift+ArrowUp/Down
  // (rather than first nudging horizontally) now captures the anchor's
  // bidi-boundary side, matching `handleExpandSelection`; the central reset
  // exempts EXPAND_LINE via `actionManagesAnchorAffinity`.
  const newAnchorAffinity = seedAnchorAffinity(editor);
  const result = moveToLine(
    editor.state,
    editor.selection.focus,
    editor.layoutTree,
    config.measurer,
    direction,
    editor.targetX,
    // #323/C1: shift+Up/Down must stay on the editing page too.
    editor.caretPageHint,
  );
  if (result === null) return editor;
  return {
    ...editor,
    selection: createSpan(editor.selection.anchor, result.position),
    targetX: result.targetX,
    // #500: thread the focus's resolved affinity (same as MOVE_LINE) so a
    // Shift+ArrowUp focus landing on a soft-wrap / column-boundary offset renders
    // on the line the move stepped onto, not the later line at the shared offset.
    caretAffinity: result.caretAffinity,
    anchorAffinity: newAnchorAffinity,
  };
}
