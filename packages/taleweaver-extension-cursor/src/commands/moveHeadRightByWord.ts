import Editor, { CursorCommand, CursorTransformation, cursorOperations, AtomicBox } from '@taleweaver/core';
import CursorExtension from '../CursorExtension';

export default function moveHeadRightByWord(cursorExtension: CursorExtension): CursorCommand {
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
    const atomicBox = atomicBoxLevelPosition.getLayoutNode();
    if (!(atomicBox instanceof AtomicBox)) {
      throw new Error(`Expecting position to be referencing an atomic box.`);
    }
    if (atomicBoxLevelPosition.getSelectableOffset() < atomicBox.getSelectableSize() - 1) {
      transformation.addOperation(new cursorOperations.MoveHeadTo(head - atomicBoxLevelPosition.getSelectableOffset() + atomicBox.getSelectableSize() - 1));
    } else {
      const nextSiblingAtomicBox = atomicBox.getNextSibling();
      if (nextSiblingAtomicBox) {
        transformation.addOperation(new cursorOperations.MoveHeadTo(head - atomicBoxLevelPosition.getSelectableOffset() + atomicBox.getSelectableSize() - 1 + nextSiblingAtomicBox.getSelectableSize()));
      }
    }
    return transformation;
  };
}
