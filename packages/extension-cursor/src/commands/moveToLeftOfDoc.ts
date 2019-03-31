import {
  Editor,
  Command,
  StateTransformation,
  CursorTransformation,
  cursorOperations,
} from '@taleweaver/core';
import CursorExtension from '../CursorExtension';

export default function moveToLeftOfDoc(cursorExtension: CursorExtension): Command {
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
