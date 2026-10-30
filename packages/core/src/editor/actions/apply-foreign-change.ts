import type { EditorState } from "../editor-state";
import type { ActionOf } from "../editor-action";
import { reconcileForeignChange } from "../reconcile-foreign-change";
import { rebaseSelection } from "../foreign-change";

/** The reducer arm of `APPLY_FOREIGN_CHANGE`: reconcile, then rebase the selection. */
export function handleApplyForeignChange(
  editor: EditorState,
  { dirtyIds }: ActionOf<"APPLY_FOREIGN_CHANGE">,
): EditorState {
  const reconciled = reconcileForeignChange(editor, dirtyIds);
  return { ...reconciled, selection: rebaseSelection(editor, reconciled) };
}
