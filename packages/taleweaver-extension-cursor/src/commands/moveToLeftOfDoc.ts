import Editor, { CursorCommand, CursorTransformation, cursorOperations } from '@taleweaver/core';
import CursorExtension from '../CursorExtension';

export default function moveToLeftOfDoc(cursorExtension: CursorExtension): CursorCommand {
  return (editor: Editor): CursorTransformation => {
    const transformation = new CursorTransformation();
    const cursor = editor.getCursor();
    if (!cursor) {
      return transformation;
    }
    transformation.addOperation(new cursorOperations.MoveTo(0));
    return transformation;
  };
}
