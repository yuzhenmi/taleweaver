import Editor from '../../Editor';
import Transformation from '../../transform/Transformation';
import AtomicBox from '../../layout/AtomicBox';
import Command from '../Command';

export default function moveLeftByWord(): Command {
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
    if (atomicBoxLevelPosition.getOffset() > 0) {
      transformation.setCursor(head - atomicBoxLevelPosition.getOffset());
    } else {
      const atomicBox = atomicBoxLevelPosition.getLayoutNode();
      if (!(atomicBox instanceof AtomicBox)) {
        throw new Error(`Expecting position to be referencing an atomic box.`);
      }
      const previousSiblingAtomicBox = atomicBox.getPreviousSibling();
      if (previousSiblingAtomicBox) {
        transformation.setCursor(head - previousSiblingAtomicBox.getSize());
      } else {
        transformation.setCursor(head);
      }
    }
    return transformation;
  };
}
