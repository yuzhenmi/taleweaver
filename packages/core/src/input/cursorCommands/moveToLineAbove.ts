import Editor from '../../Editor';
import Command from '../Command';
import StateTransformation from '../../state/Transformation';
import CursorTransformation from '../../cursor/Transformation';
import * as cursorOperations from '../../cursor/operations';
import LineFlowBox from '../../layout/LineFlowBox';

export default function moveToLineAbove(): Command {
  return (editor: Editor): [StateTransformation, CursorTransformation] => {
    const stateTransformation = new StateTransformation();
    const cursorTransformation = new CursorTransformation();
    const cursor = editor.getCursor();
    if (!cursor) {
      return [stateTransformation, cursorTransformation];
    }
    const offset = Math.min(cursor.getAnchor(), cursor.getHead());
    const docBox = editor.getLayoutEngine().getDocBox();
    const position = docBox.resolvePosition(offset);
    const lineFlowBoxLevelPosition = position.getLineFlowBoxLevel();
    const lineFlowBox = lineFlowBoxLevelPosition.getLayoutNode();
    if (!(lineFlowBox instanceof LineFlowBox)) {
      throw new Error(`Expecting position to be referencing an line box.`);
    }
    const previousLineFlowBox = lineFlowBox.getPreviousSibling();
    if (!previousLineFlowBox) {
      cursorTransformation.addOperation(new cursorOperations.MoveTo(offset - lineFlowBoxLevelPosition.getSelectableOffset()));
    } else {
      let leftAnchor = cursor.getLeftAnchor();
      if (!leftAnchor) {
        leftAnchor = lineFlowBox.resolveSelectableOffsetRangeToViewportBoundingRects(
          lineFlowBoxLevelPosition.getSelectableOffset(),
          lineFlowBoxLevelPosition.getSelectableOffset(),
        )[0].left;
      }
      cursorTransformation.setLeftAnchor(leftAnchor);
      const targetLineSelectableOffset = previousLineFlowBox.resolveViewportPositionToSelectableOffset(leftAnchor);
      cursorTransformation.addOperation(new cursorOperations.MoveTo(offset - lineFlowBoxLevelPosition.getSelectableOffset() - previousLineFlowBox.getSelectableSize() + targetLineSelectableOffset));
    }
    return [stateTransformation, cursorTransformation];
  };
}
