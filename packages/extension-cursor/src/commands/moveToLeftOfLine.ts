import {
  Editor,
  Command,
  StateTransformation,
  CursorTransformation,
  cursorOperations,
} from '@taleweaver/core';
import CursorExtension from '../CursorExtension';

export default function moveToLeftOfLine(cursorExtension: CursorExtension): Command {
  return (editor: Editor): [StateTransformation, CursorTransformation] => {
    const stateTransformation = new StateTransformation();
    const cursorTransformation = new CursorTransformation();
    const cursor = editor.getCursor();
    if (!cursor) {
      return [stateTransformation, cursorTransformation];
    }
    const head = cursor.getHead();
    const docBox = editor.getLayoutEngine().getDocBox();
    const position = docBox.resolvePosition(head);
    const lineBoxLevelPosition = position.getLineFlowBoxLevel();
    if (lineBoxLevelPosition.getSelectableOffset() > 0) {
      cursorTransformation.addOperation(new cursorOperations.MoveTo(head - lineBoxLevelPosition.getSelectableOffset()));
    } else {
      cursorTransformation.addOperation(new cursorOperations.MoveTo(head));
    }
    return [stateTransformation, cursorTransformation];
  };
}
