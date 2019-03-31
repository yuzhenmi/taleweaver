import {
  Editor,
  Command,
  StateTransformation,
  CursorTransformation,
  cursorOperations,
} from '@taleweaver/core';
import CursorExtension from '../CursorExtension';

export default function moveHeadToRightOfDoc(cursorExtension: CursorExtension): Command {
  return (editor: Editor): [StateTransformation, CursorTransformation] => {
    const stateTransformation = new StateTransformation();
    const cursorTransformation = new CursorTransformation();
    const cursor = editor.getCursor();
    if (!cursor) {
      return [stateTransformation, cursorTransformation];
    }
    const docBox = editor.getLayoutEngine().getDocBox();
    cursorTransformation.addOperation(new cursorOperations.MoveHeadTo(docBox.getSelectableSize() - 1));
    return [stateTransformation, cursorTransformation];
  };
}
