import type { EditorState } from "../editor-state";
import type { Edit } from "../edit";
import { reopenComment } from "../../state";
import type { ActionOf } from "../editor-action";
import { handleResolveComment } from "./resolve-comment";

/**
 * `REOPEN_COMMENT` handler — flips the thread record's `resolved` flag back to
 * `false`. The exact mirror of {@link handleResolveComment}: undoable tracked
 * write, identity no-op when absent or already open, selection unchanged.
 */
export function handleReopenComment(editor: EditorState, { id }: ActionOf<"REOPEN_COMMENT">): Edit | null {
  return { change: reopenComment(editor.document, id) };
}
