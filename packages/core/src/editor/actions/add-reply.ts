import type { EditorState } from "../editor-state";
import type { Edit } from "../edit";
import { addReply } from "../../state";
import type { ActionOf } from "../editor-action";

/**
 * `ADD_REPLY` handler — appends a reply to the thread record's `replies` array
 * (a tracked side-table write; undoable). Identity no-op (returns the editor
 * UNCHANGED) when the comment is absent. The selection is unaffected.
 */
export function handleAddReply(
  editor: EditorState,
  { commentId, replyId, author, body, createdAt }: ActionOf<"ADD_REPLY">,
): Edit | null {
  return {
    change: addReply(editor.document, commentId, {
      replyId,
      author,
      body,
      createdAt,
    }),
  };
}
