import type { EditorState } from "../editor-state";
import type { Edit } from "../edit";
import { deleteComment, createPosition, createSpan, getBlock, COMMENT_START_EMBED_TYPE, COMMENT_END_EMBED_TYPE, type CommentId, type Position } from "../../state";
import type { ActionOf } from "../editor-action";

/**
 * `DELETE_COMMENT` handler — removes BOTH markers from content AND the thread
 * record, in ONE tracked transaction (undoable as a unit; redo re-adds).
 * Identity no-op (returns the editor UNCHANGED) when the comment is absent.
 *
 * Invoked from the comment sidebar, so the document selection is typically in an
 * UNRELATED block. The `after` selection is the current selection REMAPPED through
 * the (zero-width) marker removal: each endpoint's offset is reduced by the number
 * of this comment's markers stripped at earlier positions in ITS block, so a
 * caret/selection that sat IN a block that lost a marker keeps its visually-correct
 * position and never lands past the shrunk block length. For an endpoint in a block
 * with no stripped markers (the sidebar-driven case — caret elsewhere) the remap is
 * the identity, so the supported path is unchanged.
 */
export function handleDeleteComment(editor: EditorState, { id }: ActionOf<"DELETE_COMMENT">): Edit | null {
  const result = deleteComment(editor.document, id);
  if (result.document === editor.document) return null;
  const remap = (p: Position): Position => {
    const stripped = strippedMarkersBefore(editor, id, p);
    return stripped === 0 ? p : createPosition(p.blockId, p.offset - stripped);
  };
  const after = createSpan(remap(editor.selection.anchor), remap(editor.selection.focus));
  return { change: result, selection: after };
}

/**
 * Count this comment's `comment-start`/`comment-end` markers in `pos`'s block that
 * sit STRICTLY BEFORE `pos.offset` (against the PRE-delete state) — the amount to
 * subtract from `pos.offset` to keep its visual position after the markers are
 * stripped. Markers are zero-width (one offset unit each), so this is exact; a
 * block with no markers for `id` yields 0 (identity remap).
 */
function strippedMarkersBefore(editor: EditorState, id: CommentId, pos: Position): number {
  const items = getBlock(editor.document, pos.blockId)?.inlineContent?.items ?? [];
  let running = 0;
  let stripped = 0;
  for (const it of items) {
    if (
      it.kind === "embed" &&
      (it.embedType === COMMENT_START_EMBED_TYPE || it.embedType === COMMENT_END_EMBED_TYPE) &&
      it.properties.commentId === id &&
      running < pos.offset
    ) {
      stripped += 1;
    }
    running += it.kind === "text" ? it.text.length : 1;
  }
  return stripped;
}
