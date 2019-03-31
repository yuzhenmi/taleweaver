import {
  Editor,
  Command,
  StateTransformation,
  CursorTransformation,
  LineFlowBox,
  cursorOperations,
} from '@taleweaver/core';
import CursorExtension from '../CursorExtension';

export default function moveHeadToRightOfLine(cursorExtension: CursorExtension): Command {
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
    const lineFlowBoxLevelPosition = position.getLineFlowBoxLevel();
    const lineFlowBox = lineFlowBoxLevelPosition.getLayoutNode();
    if (!(lineFlowBox instanceof LineFlowBox)) {
      throw new Error(`Expecting position to be referencing an line box.`);
    }
    if (lineFlowBoxLevelPosition.getSelectableOffset() < lineFlowBox.getSelectableSize() - 1) {
      cursorTransformation.addOperation(new cursorOperations.MoveHeadTo(head - lineFlowBoxLevelPosition.getSelectableOffset() + lineFlowBox.getSelectableSize() - 1));
    } else {
      cursorTransformation.addOperation(new cursorOperations.MoveHeadTo(head));
    }
    return [stateTransformation, cursorTransformation];
  };
}
