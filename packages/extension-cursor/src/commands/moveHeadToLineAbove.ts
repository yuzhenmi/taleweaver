import {
  Editor,
  Command,
  StateTransformation,
  CursorTransformation,
  LineFlowBox,
  cursorOperations,
} from '@taleweaver/core';
import CursorExtension from '../CursorExtension';

export default function moveHeadToLineAbove(cursorExtension: CursorExtension): Command {
  return (editor: Editor): [StateTransformation, CursorTransformation] => {
    const stateTransformation = new StateTransformation();
    const cursorTransformation = new CursorTransformation();
    const cursor = editor.getCursor();
    if (!cursor) {
      return [stateTransformation, cursorTransformation];
    }
    const offset = cursor.getHead();
    const docBox = editor.getLayoutEngine().getDocBox();
    const position = docBox.resolvePosition(offset);
    const lineFlowBoxLevelPosition = position.getLineFlowBoxLevel();
    const lineFlowBox = lineFlowBoxLevelPosition.getLayoutNode();
    if (!(lineFlowBox instanceof LineFlowBox)) {
      throw new Error(`Expecting position to be referencing an line box.`);
    }
    const previousLineFlowBox = lineFlowBox.getPreviousSibling();
    if (!previousLineFlowBox) {
      cursorTransformation.addOperation(new cursorOperations.MoveHeadTo(offset - lineFlowBoxLevelPosition.getSelectableOffset()));
    } else {
      let leftAnchor: number;
      if (cursorExtension.getLeftAnchor() !== null) {
        leftAnchor = cursorExtension.getLeftAnchor()!;
      } else {
        leftAnchor = lineFlowBox.resolveSelectableOffsetRangeToViewportBoundingRects(
          lineFlowBoxLevelPosition.getSelectableOffset(),
          lineFlowBoxLevelPosition.getSelectableOffset(),
        )[0].left;
      }
      cursorTransformation.setLeftAnchor(leftAnchor);
      const targetLineSelectableOffset = previousLineFlowBox.resolveViewportPositionToSelectableOffset(leftAnchor);
      cursorTransformation.addOperation(new cursorOperations.MoveHeadTo(offset - lineFlowBoxLevelPosition.getSelectableOffset() - previousLineFlowBox.getSelectableSize() + targetLineSelectableOffset));
    }
    return [stateTransformation, cursorTransformation];
  };
}
