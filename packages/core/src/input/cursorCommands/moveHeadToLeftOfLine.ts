import Editor from '../../Editor';
import Command from '../Command';
import StateTransformation from '../../state/Transformation';
import CursorTransformation from '../../cursor/Transformation';
import * as cursorOperations from '../../cursor/operations';

export default function moveHeadToLeftOfLine(): Command {
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
    const lineBoxLevelPosition = position.getLineFlowBoxLevel();
    if (lineBoxLevelPosition.getSelectableOffset() > 0) {
      cursorTransformation.addOperation(new cursorOperations.MoveHeadTo(head - lineBoxLevelPosition.getSelectableOffset()));
    } else {
      cursorTransformation.addOperation(new cursorOperations.MoveHeadTo(head));
    }
    return [stateTransformation, cursorTransformation];
  };
}
