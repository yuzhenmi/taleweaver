import Editor, { CursorCommand, CursorTransformation, cursorOperations, AtomicBox } from '@taleweaver/core';
import CursorExtension from '../CursorExtension';

export default function moveLeftByWord(cursorExtension: CursorExtension): CursorCommand {
  return (editor: Editor): CursorTransformation => {
    const transformation = new CursorTransformation();
    const cursor = editor.getCursor();
    if (!cursor) {
      return transformation;
    }
    const head = cursor.getHead();
    const docLayout = editor.getLayoutEngine().getDocLayout();
    const position = docLayout.resolvePosition(head);
    const atomicBoxLevelPosition = position.getAtomicBoxLevel();
    if (atomicBoxLevelPosition.getSelectableOffset() > 0) {
      transformation.addOperation(new cursorOperations.MoveTo(head - atomicBoxLevelPosition.getSelectableOffset()));
    } else {
      const atomicBox = atomicBoxLevelPosition.getLayoutNode();
      if (!(atomicBox instanceof AtomicBox)) {
        throw new Error(`Expecting position to be referencing an atomic box.`);
      }
      const previousSiblingAtomicBox = atomicBox.getPreviousSibling();
      if (previousSiblingAtomicBox) {
        transformation.addOperation(new cursorOperations.MoveTo(head - previousSiblingAtomicBox.getSelectableSize()));
      } else {
        transformation.addOperation(new cursorOperations.MoveTo(head));
      }
    }
    return transformation;
  };
}
