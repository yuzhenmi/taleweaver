import type { EditorState, EditorConfig } from "../editor-state";
import { createSpan } from "../../state";
import { moveToLineBoundary } from "../../cursor/line-navigation";

export function handleMoveLineBoundary(
  editor: EditorState,
  boundary: "start" | "end",
  config: EditorConfig,
): EditorState {
  const pos = moveToLineBoundary(
    editor.state,
    editor.selection.focus,
    editor.layoutTree,
    config.measurer,
    boundary,
    // #323/C1: Home/End on a header/footer resolves on the editing page.
    editor.caretPageHint,
  );
  if (pos === null) return editor;
  // P4-C.2.6 §G: Home/End are LOGICAL boundaries — the offset is unchanged
  // (`moveToLineBoundary` already maps start→inlineOffsetStart, end→inlineOffsetEnd
  // in BOTH directions). We only seed a direction-independent `caretAffinity` so
  // the logical boundary RENDERS at the correct visual edge of an RTL line:
  //   Home (boundary "start") → "after"  → the caret belongs to the FIRST logical
  //     leaf, which in an RTL line renders at the visual-START = right edge.
  //   End  (boundary "end")   → "before" → the caret belongs to the LAST logical
  //     leaf, which in an RTL line renders at the visual-END = left edge.
  // (On a uniform LTR line the affinity is inert — there is only one leaf.)
  // `MOVE_LINE_BOUNDARY` is registered in `actionManagesCaretAffinity` so the
  // central reset preserves this; a later edit clears it.
  // TODO(C.2.7 browser-confirm): the logical-Home convention (Home → logical line
  // start in both directions) is near-universal (W3C editing, Word, Google Docs),
  // but the exact Google-Docs RTL Home/End behavior is the same browser-divergent
  // class as C.2.3's visual-motion flags; confirm in the browser smoke.
  const caretAffinity = boundary === "start" ? "after" : "before";
  return { ...editor, selection: createSpan(pos, pos), caretAffinity };
}
