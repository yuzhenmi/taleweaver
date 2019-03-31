import {
  Editor,
  Command,
  StateTransformation,
  CursorTransformation,
  cursorOperations,
} from '@taleweaver/core';
import CursorExtension from '../CursorExtension';

export default function moveHeadLeft(cursorExtension: CursorExtension): Command {
  return (editor: Editor): [StateTransformation, CursorTransformation] => {
    const stateTransformation = new StateTransformation();
    const cursorTransformation = new CursorTransformation();
    const cursor = editor.getCursor();
    if (!cursor) {
      return [stateTransformation, cursorTransformation];
    }
    const head = cursor.getHead();
    const docBox = editor.getLayoutEngine().getDocBox();
    if (head >= docBox.getSelectableSize() - 1) {
      return [stateTransformation, cursorTransformation];
    }
    cursorTransformation.addOperation(new cursorOperations.MoveHeadTo(head + 1));
    return [stateTransformation, cursorTransformation];
  };
}
