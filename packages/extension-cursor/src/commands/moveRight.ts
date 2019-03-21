import {
  Editor,
  CursorCommand,
  CursorTransformation,
  cursorOperations,
} from '@taleweaver/core';
import CursorExtension from '../CursorExtension';

export default function moveRight(cursorExtension: CursorExtension): CursorCommand {
  return (editor: Editor): CursorTransformation => {
    const transformation = new CursorTransformation();
    const cursor = editor.getCursor();
    if (!cursor) {
      return transformation;
    }
    const anchor = cursor.getAnchor();
    const head = cursor.getHead();
    const docLayout = editor.getLayoutEngine().getDocLayout();
    if (anchor === head) {
      if (head >= docLayout.getSelectableSize() - 1) {
        return transformation;
      }
      transformation.addOperation(new cursorOperations.MoveTo(head + 1));
    } else {
      if (anchor < head) {
        transformation.addOperation(new cursorOperations.MoveTo(head));
      } else if (anchor > head) {
        transformation.addOperation(new cursorOperations.MoveTo(anchor));
      }
    }
    return transformation;
  };
}
