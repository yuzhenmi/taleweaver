import type { EditorState } from "../editor-state";
import type { Edit } from "../edit";
import { createPosition, createSpan, selectionContextOf } from "../../state";
import { firstBoundaryBlock } from "./helpers/first-boundary-block";
import { lastBoundaryBlock } from "./helpers/last-boundary-block";
import { endOffsetOf } from "./helpers/end-offset-of";
import type { ActionOf } from "../editor-action";

/**
 * MOVE_DOCUMENT_BOUNDARY (Ctrl+Home / Ctrl+End) — CONTEXT-AWARE, the collapsed
 * sibling of `handleExpandDocumentBoundary`. The caret moves to the document
 * boundary WITHIN its current selection context (the main document tree, OR the
 * one footnote/embed body, OR the one header/footer template body it sits in) —
 * NOT the main-tree boundary. So Ctrl+End inside a footnote lands at the
 * footnote's end (Google-Docs parity), staying in context, rather than jumping
 * out to the main document end. Shares the in-context boundary resolution with
 * `handleExpandDocumentBoundary`; the only difference is the result is collapsed.
 */
export function handleMoveDocumentBoundary(
  editor: EditorState,
  { boundary }: ActionOf<"MOVE_DOCUMENT_BOUNDARY">,
): Edit | null {
  const ctxRoot = selectionContextOf(editor.state, editor.selection.focus.blockId);
  if (ctxRoot === null) return null;

  const targetId =
    boundary === "start"
      ? firstBoundaryBlock(editor.state, ctxRoot)
      : lastBoundaryBlock(editor.state, ctxRoot);
  if (targetId === null) return null;

  const offset = boundary === "start" ? 0 : endOffsetOf(editor.state, targetId);
  if (offset === null) return null;

  const pos = createPosition(targetId, offset);
  return { selection: createSpan(pos, pos) };
}
