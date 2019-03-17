import CursorExtension from '../CursorExtension';
import Command from '../Command';
import Transformation from '../Transformation';
import { MoveHeadTo } from '../operations'
import AtomicBox from '../../layout/AtomicBox';

export default function moveHeadRightByWord(): Command {
  return (cursorExtension: CursorExtension): Transformation => {
    const transformation = new Transformation();
    const cursor = cursorExtension.getCursor();
    if (!cursor) {
      return transformation;
    }
    const head = cursor.getHead();
    const provider = cursorExtension.getProvider();
    const docLayout = provider.getDocLayout();
    const position = docLayout.resolvePosition(head);
    const atomicBoxLevelPosition = position.getAtomicBoxLevel();
    const atomicBox = atomicBoxLevelPosition.getLayoutNode();
    if (!(atomicBox instanceof AtomicBox)) {
      throw new Error(`Expecting position to be referencing an atomic box.`);
    }
    if (atomicBoxLevelPosition.getSelectableOffset() < atomicBox.getSelectableSize() - 1) {
      transformation.addOperation(new MoveHeadTo(head - atomicBoxLevelPosition.getSelectableOffset() + atomicBox.getSelectableSize() - 1));
    } else {
      const nextSiblingAtomicBox = atomicBox.getNextSibling();
      if (nextSiblingAtomicBox) {
        transformation.addOperation(new MoveHeadTo(head - atomicBoxLevelPosition.getSelectableOffset() + atomicBox.getSelectableSize() - 1 + nextSiblingAtomicBox.getSelectableSize()));
      }
    }
    return transformation;
  };
}
