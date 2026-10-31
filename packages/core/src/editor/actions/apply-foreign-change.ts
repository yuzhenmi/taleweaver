import type { EditorState } from "../editor-state";
import type { Edit } from "../edit";
import { freshDocument } from "../../state";
import type { ActionOf } from "../editor-action";

/** The reducer arm of `APPLY_FOREIGN_CHANGE`: reconcile, then rebase the selection. */
export function handleApplyForeignChange(
  editor: EditorState,
  { dirtyIds }: ActionOf<"APPLY_FOREIGN_CHANGE">,
): Edit | null {
  // A peer's change is already in the Y.Doc: re-read its blocks (`freshDocument`), rebase
  // the selection through it, and let history follow it — it is not ours to undo.
  return { change: { document: freshDocument(editor.document, dirtyIds), dirtyIds }, selection: "rebase", undoable: false };
}
