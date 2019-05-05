import Editor from '../../Editor';
import Command from '../Command';
import StateTransformation from '../../token/Transformation';
import CursorTransformation from '../../cursor/Transformation';
import * as cursorOperations from '../../cursor/operations';

export default function moveToLeftOfDoc(): Command {
  return (editor: Editor): [StateTransformation, CursorTransformation] => {
    const stateTransformation = new StateTransformation();
    const cursorTransformation = new CursorTransformation();
    const cursor = editor.getCursor();
    if (!cursor) {
      return [stateTransformation, cursorTransformation];
    }
    cursorTransformation.addOperation(new cursorOperations.MoveTo(0));
    return [stateTransformation, cursorTransformation];
  };
}
