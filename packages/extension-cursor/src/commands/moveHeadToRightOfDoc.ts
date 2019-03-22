import {
  Editor,
  CursorCommand,
  CursorTransformation,
  cursorOperations,
} from '@taleweaver/core';
import CursorExtension from '../CursorExtension';

export default function moveHeadToRightOfDoc(cursorExtension: CursorExtension): CursorCommand {
  return (editor: Editor): CursorTransformation => {
    const transformation = new CursorTransformation();
    const cursor = editor.getCursor();
    if (!cursor) {
      return transformation;
    }
    const docLayout = editor.getLayoutEngine().getDocLayout();
    transformation.addOperation(new cursorOperations.MoveHeadTo(docLayout.getSelectableSize() - 1));
    return transformation;
  };
}
