import Editor from '../../Editor';
import Transformation from '../../transform/Transformation';
import AtomicBox from '../../layout/AtomicBox';
import Command from '../Command';

export default function moveHeadRightByWord(): Command {
  return (editor: Editor): Transformation => {
    const transformation = new Transformation();
    const cursor = editor.getCursor();
    if (!cursor) {
      return transformation;
    }
    const head = cursor.getHead();
    const docBox = editor.getLayoutManager().getDocBox();
    const position = docBox.resolvePosition(head);
    const atomicBoxLevelPosition = position.getAtomicBoxLevel();
    const atomicBox = atomicBoxLevelPosition.getLayoutNode();
    if (!(atomicBox instanceof AtomicBox)) {
      throw new Error(`Expecting position to be referencing an atomic box.`);
    }
    if (atomicBoxLevelPosition.getSelectableOffset() < atomicBox.getSelectableSize() - 1) {
      transformation.setCursorHead(head - atomicBoxLevelPosition.getSelectableOffset() + atomicBox.getSelectableSize() - 1);
    } else {
      const nextSiblingAtomicBox = atomicBox.getNextSibling();
      if (nextSiblingAtomicBox) {
        transformation.setCursorHead(head - atomicBoxLevelPosition.getSelectableOffset() + atomicBox.getSelectableSize() - 1 + nextSiblingAtomicBox.getSelectableSize());
      }
    }
    return transformation;
  };
}
