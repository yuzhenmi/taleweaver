import {
  Editor,
  CursorCommand,
  CursorTransformation,
  AtomicBox,
  cursorOperations,
} from '@taleweaver/core';
import CursorExtension from '../CursorExtension';

export default function moveHeadLeftByWord(cursorExtension: CursorExtension): CursorCommand {
  return (editor: Editor): CursorTransformation => {
    const transformation = new CursorTransformation();
    const cursor = editor.getCursor();
    if (!cursor) {
      return transformation;
    }
    const head = cursor.getHead();
    const docBox = editor.getLayoutEngine().getDocBox();
    const position = docBox.resolvePosition(head);
    const atomicBoxLevelPosition = position.getAtomicBoxLevel();
    if (atomicBoxLevelPosition.getSelectableOffset() > 0) {
      transformation.addOperation(new cursorOperations.MoveHeadTo(head - atomicBoxLevelPosition.getSelectableOffset()));
    } else {
      const atomicBox = atomicBoxLevelPosition.getLayoutNode();
      if (!(atomicBox instanceof AtomicBox)) {
        throw new Error(`Expecting position to be referencing an atomic box.`);
      }
      const previousSiblingAtomicBox = atomicBox.getPreviousSibling();
      if (previousSiblingAtomicBox) {
        transformation.addOperation(new cursorOperations.MoveHeadTo(head - previousSiblingAtomicBox.getSelectableSize()));
      }
    }
    return transformation;
  };
}
