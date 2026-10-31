import type { EditorState } from "../editor-state";
import type { Edit } from "../edit";
import { createPosition, createSpan, selectionContextOf } from "../../state";
import type { ActionOf } from "../editor-action";
import { firstBoundaryBlock } from "./helpers/first-boundary-block";
import { lastBoundaryBlock } from "./helpers/last-boundary-block";
import { endOffsetOf } from "./helpers/end-offset-of";

/**
 * EXPAND_DOCUMENT_BOUNDARY (Ctrl+Shift+Home / Ctrl+Shift+End) — CONTEXT-AWARE,
 * mirroring `handleSelectAll`. The anchor stays put; the focus moves to the
 * document boundary WITHIN the caret's current selection context (the main
 * document tree, OR the one footnote/embed body, OR the one header/footer
 * template body the caret sits in). Resolving in-context is load-bearing: a
 * main-tree-only resolution from inside a footnote body would leave the anchor
 * in the footnote and push the focus into the main tree — a CROSS-CONTEXT span
 * that `iterateSpan` (and every span consumer) rejects. Keeping the focus in the
 * same context guarantees the resulting span is iterable.
 *
 * The caret's context is `selectionContextOf(state, focus.blockId)`:
 * `state.rootId` for a main-body block, or the footnote/header/footer body's
 * CONTAINER ROOT for a body block.
 */
export function handleExpandDocumentBoundary(
  editor: EditorState,
  { boundary }: ActionOf<"EXPAND_DOCUMENT_BOUNDARY">,
): Edit | null {
  const ctxRoot = selectionContextOf(editor.document, editor.selection.focus.blockId);
  if (ctxRoot === null) return null;

  const targetId =
    boundary === "start"
      ? firstBoundaryBlock(editor.document, ctxRoot)
      : lastBoundaryBlock(editor.document, ctxRoot);
  if (targetId === null) return null;

  const offset = boundary === "start" ? 0 : endOffsetOf(editor.document, targetId);
  if (offset === null) return null;

  const focus = createPosition(targetId, offset);
  return { selection: createSpan(editor.selection.anchor, focus) };
}
