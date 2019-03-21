import Editor, { CursorCommand, CursorTransformation, cursorOperations } from '@taleweaver/core';
import CursorExtension from '../CursorExtension';

export default function moveToLeftOfLine(cursorExtension: CursorExtension): CursorCommand {
  return (editor: Editor): CursorTransformation => {
    const transformation = new CursorTransformation();
    const cursor = editor.getCursor();
    if (!cursor) {
      return transformation;
    }
    const head = cursor.getHead();
    const docLayout = editor.getLayoutEngine().getDocLayout();
    const position = docLayout.resolvePosition(head);
    const lineBoxLevelPosition = position.getLineBoxLevel();
    if (lineBoxLevelPosition.getSelectableOffset() > 0) {
      transformation.addOperation(new cursorOperations.MoveTo(head - lineBoxLevelPosition.getSelectableOffset()));
    } else {
      transformation.addOperation(new cursorOperations.MoveTo(head));
    }
    return transformation;
  };
}
