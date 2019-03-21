import {
  Editor,
  CursorCommand,
  CursorTransformation,
  cursorOperations,
} from '@taleweaver/core';
import CursorExtension from '../CursorExtension';

export default function moveHeadLeft(cursorExtension: CursorExtension): CursorCommand {
  return (editor: Editor): CursorTransformation => {
    const transformation = new CursorTransformation();
    const cursor = editor.getCursor();
    if (!cursor) {
      return transformation;
    }
    const head = cursor.getHead();
    const docLayout = editor.getLayoutEngine().getDocLayout();
    if (head >= docLayout.getSelectableSize() - 1) {
      return transformation;
    }
    transformation.addOperation(new cursorOperations.MoveHeadTo(head + 1));
    return transformation;
  };
}
