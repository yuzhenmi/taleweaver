import type { EditorState, EditorConfig } from "../editor-state";
import { seedAnchorAffinity } from "../editor-state";
import { createSpan } from "../../state";
import { moveToLineBoundary } from "../../cursor/line-navigation";

export function handleExpandLineBoundary(
  editor: EditorState,
  boundary: "start" | "end",
  config: EditorConfig,
): EditorState {
  // #503: seed/persist `anchorAffinity` BEFORE mutating the selection (the seed
  // reads the still-collapsed span). A selection STARTED with Shift+Home/End now
  // captures the anchor's bidi-boundary side, matching `handleExpandSelection`;
  // the central reset exempts EXPAND_LINE_BOUNDARY via `actionManagesAnchorAffinity`.
  const newAnchorAffinity = seedAnchorAffinity(editor);
  const pos = moveToLineBoundary(
    editor.state,
    editor.selection.focus,
    editor.layoutTree,
    config.measurer,
    boundary,
    // #323/C1: shift+Home/End on a header/footer resolves on the editing page.
    editor.caretPageHint,
  );
  if (pos === null) return editor;
  // P4-C.2.6 §G: Shift+Home/End move the FOCUS to a logical line boundary (the
  // anchor is fixed). The offset is unchanged (logical boundaries in BOTH
  // directions); we seed the FOCUS's direction-independent `caretAffinity` so the
  // logical boundary renders at the correct visual edge of an RTL line:
  //   Home (boundary "start") → "after"  (first logical leaf → visual-start edge)
  //   End  (boundary "end")   → "before" (last logical leaf → visual-end edge)
  // `EXPAND_LINE_BOUNDARY` is registered in `actionManagesCaretAffinity` so the
  // central reset preserves this; a later edit clears it.
  // TODO(C.2.7 browser-confirm): the logical-Home convention is near-universal,
  // but exact Google-Docs RTL Home/End behavior is the same browser-divergent
  // class as C.2.3's visual-motion flags; confirm in the browser smoke.
  const caretAffinity = boundary === "start" ? "after" : "before";
  return {
    ...editor,
    selection: createSpan(editor.selection.anchor, pos),
    caretAffinity,
    anchorAffinity: newAnchorAffinity,
  };
}
