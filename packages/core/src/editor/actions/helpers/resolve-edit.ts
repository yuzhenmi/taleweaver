import type { Edit } from "../../edit";
import { type OperationResult } from "../../../state";

/**
 * Suggestion RESOLVE actions. Each is ONE undoable history entry: the resolve op is an
 * ordinary tracked transaction; undo restores the records and the tagged runs exactly.
 * The selection is rebased through the change (a rejected insertion before the caret
 * moves it back, etc.).
 */
export function resolveEdit(result: OperationResult): Edit {
  return { change: result, selection: "rebase" };
}
