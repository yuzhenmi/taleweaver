import {
  Editor,
  CursorCommand,
  CursorTransformation,
  cursorOperations,
} from '@taleweaver/core';
import CursorExtension from '../CursorExtension';

export default function selectAll(cursorExtension: CursorExtension): CursorCommand {
  return (editor: Editor): CursorTransformation => {
    const transformation = new CursorTransformation();
    const cursor = editor.getCursor();
    if (!cursor) {
      return transformation;
    }
    const docBox = editor.getLayoutEngine().getDocBox();
    transformation.addOperation(new cursorOperations.MoveTo(0));
    transformation.addOperation(new cursorOperations.MoveHeadTo(docBox.getSelectableSize() - 1));
    return transformation;
  };
}
