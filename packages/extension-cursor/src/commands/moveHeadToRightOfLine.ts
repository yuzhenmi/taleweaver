import {
  Editor,
  CursorCommand,
  CursorTransformation,
  LineFlowBox,
  cursorOperations,
} from '@taleweaver/core';
import CursorExtension from '../CursorExtension';

export default function moveHeadToRightOfLine(cursorExtension: CursorExtension): CursorCommand {
  return (editor: Editor): CursorTransformation => {
    const transformation = new CursorTransformation();
    const cursor = editor.getCursor();
    if (!cursor) {
      return transformation;
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
      transformation.addOperation(new cursorOperations.MoveHeadTo(head - lineFlowBoxLevelPosition.getSelectableOffset() + lineFlowBox.getSelectableSize() - 1));
    } else {
      transformation.addOperation(new cursorOperations.MoveHeadTo(head));
    }
    return transformation;
  };
}
