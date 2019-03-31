import {
  Editor,
  Command,
  StateTransformation,
  CursorTransformation,
  stateOperations,
  cursorOperations,
} from '@taleweaver/core';
import EditExtension from '../EditExtension';

export default function deleteForward(editExtension: EditExtension): Command {
  return (editor: Editor): [StateTransformation, CursorTransformation] => {
    const cursorAnchor = editor.getCursor().getAnchor();
    const cursorHead = editor.getCursor().getHead();
    const anchor = editor.convertSelectableOffsetToModelOffset(cursorAnchor);
    const head = editor.convertSelectableOffsetToModelOffset(cursorHead);
    const stateTransformation = new StateTransformation();
    const cursorTransformation = new CursorTransformation();
    if (anchor !== head) {
      stateTransformation.addOperation(new stateOperations.Delete(Math.min(anchor, head), Math.max(anchor, head) - 1));
      cursorTransformation.addOperation(new cursorOperations.MoveTo(Math.min(cursorAnchor, cursorHead)));
    } else if (head > 0) {
      stateTransformation.addOperation(new stateOperations.Delete(head, head));
      cursorTransformation.addOperation(new cursorOperations.MoveTo(cursorHead));
    }
    return [stateTransformation, cursorTransformation];
  };
}
