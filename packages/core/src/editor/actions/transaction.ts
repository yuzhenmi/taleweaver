import type { EditorState } from "../editor-state";
import { runTransaction, type Reduce } from "../extensions";
import type { ActionOf } from "../editor-action";

export function handleTransaction(editor: EditorState, action: ActionOf<"TRANSACTION">, reduce: Reduce): EditorState {
  return runTransaction(editor, action.run, reduce);
}
