import {
  Editor,
  CursorCommand,
  CursorTransformation,
  cursorOperations,
} from '@taleweaver/core';
import CursorExtension from '../CursorExtension';

export default function moveHeadToLeftOfLine(cursorExtension: CursorExtension): CursorCommand {
  return (editor: Editor): CursorTransformation => {
    const transformation = new CursorTransformation();
    const cursor = editor.getCursor();
    if (!cursor) {
      return transformation;
    }
    const head = cursor.getHead();
    const docBox = editor.getLayoutEngine().getDocBox();
    const position = docBox.resolvePosition(head);
    const lineBoxLevelPosition = position.getLineBoxLevel();
    if (lineBoxLevelPosition.getSelectableOffset() > 0) {
      transformation.addOperation(new cursorOperations.MoveHeadTo(head - lineBoxLevelPosition.getSelectableOffset()));
    } else {
      transformation.addOperation(new cursorOperations.MoveHeadTo(head));
    }
    return transformation;
  };
}
