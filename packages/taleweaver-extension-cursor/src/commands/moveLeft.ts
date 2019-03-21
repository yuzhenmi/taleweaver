import Editor, { CursorCommand, CursorTransformation, cursorOperations } from '@taleweaver/core';
import CursorExtension from '../CursorExtension';

export default function moveLeft(cursorExtension: CursorExtension): CursorCommand {
  return (editor: Editor): CursorTransformation => {
    const transformation = new CursorTransformation();
    const cursor = editor.getCursor();
    if (!cursor) {
      return transformation;
    }
    const anchor = cursor.getAnchor();
    const head = cursor.getHead();
    if (anchor === head) {
      if (head < 1) {
        return transformation;
      }
      transformation.addOperation(new cursorOperations.MoveTo(head - 1));
    } else {
      if (anchor < head) {
        transformation.addOperation(new cursorOperations.MoveTo(anchor));
      } else if (anchor > head) {
        transformation.addOperation(new cursorOperations.MoveTo(head));
      }
    }
    return transformation;
  };
}
