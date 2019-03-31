import {
  Editor,
  Command,
  StateTransformation,
  CursorTransformation,
  cursorOperations,
} from '@taleweaver/core';
import CursorExtension from '../CursorExtension';

export default function moveHeadToLeftOfDoc(cursorExtension: CursorExtension): Command {
  return (editor: Editor): [StateTransformation, CursorTransformation] => {
    const stateTransformation = new StateTransformation();
    const cursorTransformation = new CursorTransformation();
    const cursor = editor.getCursor();
    if (!cursor) {
      return [stateTransformation, cursorTransformation];
    }
    cursorTransformation.addOperation(new cursorOperations.MoveHeadTo(0));
    return [stateTransformation, cursorTransformation];
  };
}
