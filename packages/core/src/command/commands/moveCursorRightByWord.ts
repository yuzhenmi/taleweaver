import Editor from '../../Editor';
import AtomicBox from '../../layout/AtomicLayoutNode';
import Transformation from '../../transform/Transformation';
import Command from '../Command';

export default function moveRightByWord(): Command {
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
      transformation.setCursor(head - atomicBoxLevelPosition.getSelectableOffset() + atomicBox.getSelectableSize() - 1);
    } else {
      const nextSiblingAtomicBox = atomicBox.getNextSibling();
      if (nextSiblingAtomicBox) {
        transformation.setCursor(head - atomicBoxLevelPosition.getSelectableOffset() + atomicBox.getSelectableSize() - 1 + nextSiblingAtomicBox.getSelectableSize());
      } else {
        transformation.setCursor(head);
      }
    }
    return transformation;
  };
}
