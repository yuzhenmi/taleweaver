import {
  Editor,
  CursorCommand,
  CursorTransformation,
  cursorOperations,
} from '@taleweaver/core';
import CursorExtension from '../CursorExtension';

export default function moveToRightOfDoc(cursorExtension: CursorExtension): CursorCommand {
  return (editor: Editor): CursorTransformation => {
    const transformation = new CursorTransformation();
    const cursor = editor.getCursor();
    if (!cursor) {
      return transformation;
    }
    const docLayout = editor.getLayoutEngine().getDocLayout();
    transformation.addOperation(new cursorOperations.MoveTo(docLayout.getSelectableSize() - 2));
    return transformation;
  };
}
