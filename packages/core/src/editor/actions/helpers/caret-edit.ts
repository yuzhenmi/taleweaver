import { createPosition, createSpan } from "../../../state";
import type { OperationResult, Position } from "../../../state";
import type { Edit } from "../../edit";

/** `result` as an edit leaving a collapsed caret at `caret`. */
export function caretEdit(result: OperationResult, caret: Position): Edit {
  return { change: result, selection: createSpan(createPosition(caret.blockId, caret.offset), createPosition(caret.blockId, caret.offset)) };
}
