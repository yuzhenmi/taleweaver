import {
  Editor,
  Command,
  StateTransformation,
  CursorTransformation,
  stateOperations,
  cursorOperations,
} from '@taleweaver/core';
import EditExtension from '../EditExtension';

export default function deleteBackward(editExtension: EditExtension): Command {
  return (editor: Editor): [StateTransformation, CursorTransformation] => {
    const stateTransformation = new StateTransformation();
    const cursorTransformation = new CursorTransformation();
    const anchor = editor.getCursor().getAnchor();
    const head = editor.getCursor().getHead();
    if (anchor < head) {
      stateTransformation.addOperation(new stateOperations.Delete(
        editor.convertSelectableOffsetToModelOffset(anchor),
        editor.convertSelectableOffsetToModelOffset(head),
      ));
      cursorTransformation.addOperation(new cursorOperations.MoveTo(anchor));
    } else if (anchor > head) {
      stateTransformation.addOperation(new stateOperations.Delete(
        editor.convertSelectableOffsetToModelOffset(head),
        editor.convertSelectableOffsetToModelOffset(anchor),
      ));
      cursorTransformation.addOperation(new cursorOperations.MoveTo(head));
    } else if (head > 0) {
      stateTransformation.addOperation(new stateOperations.Delete(
        editor.convertSelectableOffsetToModelOffset(head - 1),
        editor.convertSelectableOffsetToModelOffset(head),
      ));
      cursorTransformation.addOperation(new cursorOperations.MoveTo(head - 1));
    }
    return [stateTransformation, cursorTransformation];
  };
}
