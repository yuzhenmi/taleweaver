import {
  Editor,
  CursorCommand,
  CursorTransformation,
  cursorOperations,
} from '@taleweaver/core';
import CursorExtension from '../CursorExtension';

export default function moveToLeftOfLine(cursorExtension: CursorExtension): CursorCommand {
  return (editor: Editor): CursorTransformation => {
    const transformation = new CursorTransformation();
    const cursor = editor.getCursor();
    if (!cursor) {
      return transformation;
    }
    const head = cursor.getHead();
    const docBox = editor.getLayoutEngine().getDocBox();
    const position = docBox.resolvePosition(head);
    const lineBoxLevelPosition = position.getLineFlowBoxLevel();
    if (lineBoxLevelPosition.getSelectableOffset() > 0) {
      transformation.addOperation(new cursorOperations.MoveTo(head - lineBoxLevelPosition.getSelectableOffset()));
    } else {
      transformation.addOperation(new cursorOperations.MoveTo(head));
    }
    return transformation;
  };
}
