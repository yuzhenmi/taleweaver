import Editor from '../../Editor';
import Command from '../Command';
import StateTransformation from '../../token/Transformation';
import CursorTransformation from '../../cursor/Transformation';
import * as cursorOperations from '../../cursor/operations';

export default function moveToLeftOfLine(): Command {
  return (editor: Editor): [StateTransformation, CursorTransformation] => {
    const stateTransformation = new StateTransformation();
    const cursorTransformation = new CursorTransformation();
    const cursor = editor.getCursor();
    if (!cursor) {
      return [stateTransformation, cursorTransformation];
    }
    const head = cursor.getHead();
    const docBox = editor.getLayoutManager().getDocBox();
    const position = docBox.resolvePosition(head);
    const lineBoxLevelPosition = position.getLineFlowBoxLevel();
    if (lineBoxLevelPosition.getSelectableOffset() > 0) {
      cursorTransformation.addOperation(new cursorOperations.MoveTo(head - lineBoxLevelPosition.getSelectableOffset()));
    } else {
      cursorTransformation.addOperation(new cursorOperations.MoveTo(head));
    }
    return [stateTransformation, cursorTransformation];
  };
}
