import Editor, { CursorCommand, CursorTransformation, cursorOperations } from '@taleweaver/core';
import CursorExtension from '../CursorExtension';

export default function moveHeadToLeftOfDoc(cursorExtension: CursorExtension): CursorCommand {
  return (editor: Editor): CursorTransformation => {
    const transformation = new CursorTransformation();
    const cursor = editor.getCursor();
    if (!cursor) {
      return transformation;
    }
    transformation.addOperation(new cursorOperations.MoveHeadTo(0));
    return transformation;
  };
}
