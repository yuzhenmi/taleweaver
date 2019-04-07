import Editor from '../../Editor';
import Command from '../Command';
import StateTransformation from '../../state/Transformation';
import CursorTransformation from '../../cursor/Transformation';
import * as cursorOperations from '../../cursor/operations';

export default function moveLeft(): Command {
  return (editor: Editor): [StateTransformation, CursorTransformation] => {
    const stateTransformation = new StateTransformation();
    const cursorTransformation = new CursorTransformation();
    const cursor = editor.getCursor();
    if (!cursor) {
      return [stateTransformation, cursorTransformation];
    }
    const anchor = cursor.getAnchor();
    const head = cursor.getHead();
    if (anchor === head) {
      if (head < 1) {
        return [stateTransformation, cursorTransformation];
      }
      cursorTransformation.addOperation(new cursorOperations.MoveTo(head - 1));
    } else {
      if (anchor < head) {
        cursorTransformation.addOperation(new cursorOperations.MoveTo(anchor));
      } else if (anchor > head) {
        cursorTransformation.addOperation(new cursorOperations.MoveTo(head));
      }
    }
    return [stateTransformation, cursorTransformation];
  };
}
