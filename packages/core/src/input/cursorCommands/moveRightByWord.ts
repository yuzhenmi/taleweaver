import Editor from '../../Editor';
import Command from '../Command';
import StateTransformation from '../../state/Transformation';
import CursorTransformation from '../../cursor/Transformation';
import * as cursorOperations from '../../cursor/operations';
import AtomicBox from '../../layout/AtomicBox';

export default function moveRightByWord(): Command {
  return (editor: Editor): [StateTransformation, CursorTransformation] => {
    const stateTransformation = new StateTransformation();
    const cursorTransformation = new CursorTransformation();
    const cursor = editor.getCursor();
    if (!cursor) {
      return [stateTransformation, cursorTransformation];
    }
    const head = cursor.getHead();
    const docBox = editor.getLayoutEngine().getDocBox();
    const position = docBox.resolvePosition(head);
    const atomicBoxLevelPosition = position.getAtomicBoxLevel();
    const atomicBox = atomicBoxLevelPosition.getLayoutNode();
    if (!(atomicBox instanceof AtomicBox)) {
      throw new Error(`Expecting position to be referencing an atomic box.`);
    }
    if (atomicBoxLevelPosition.getSelectableOffset() < atomicBox.getSelectableSize() - 1) {
      cursorTransformation.addOperation(new cursorOperations.MoveTo(head - atomicBoxLevelPosition.getSelectableOffset() + atomicBox.getSelectableSize() - 1));
    } else {
      const nextSiblingAtomicBox = atomicBox.getNextSibling();
      if (nextSiblingAtomicBox) {
        cursorTransformation.addOperation(new cursorOperations.MoveTo(head - atomicBoxLevelPosition.getSelectableOffset() + atomicBox.getSelectableSize() - 1 + nextSiblingAtomicBox.getSelectableSize()));
      } else {
        cursorTransformation.addOperation(new cursorOperations.MoveTo(head));
      }
    }
    return [stateTransformation, cursorTransformation];
  };
}
