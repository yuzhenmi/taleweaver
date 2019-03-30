import {
  Editor,
  CursorCommand,
  CursorTransformation,
  LineFlowBox,
  cursorOperations,
} from '@taleweaver/core';
import CursorExtension from '../CursorExtension';

export default function moveToLineBelow(cursorExtension: CursorExtension): CursorCommand {
  return (editor: Editor): CursorTransformation => {
    const transformation = new CursorTransformation();
    const cursor = editor.getCursor();
    if (!cursor) {
      return transformation;
    }
    const offset = Math.max(cursor.getAnchor(), cursor.getHead());
    const docBox = editor.getLayoutEngine().getDocBox();
    const position = docBox.resolvePosition(offset);
    const lineFlowBoxLevelPosition = position.getLineFlowBoxLevel();
    const lineFlowBox = lineFlowBoxLevelPosition.getLayoutNode();
    if (!(lineFlowBox instanceof LineFlowBox)) {
      throw new Error(`Expecting position to be referencing an line box.`);
    }
    const nextLineFlowBox = lineFlowBox.getNextSibling();
    if (!nextLineFlowBox) {
      transformation.addOperation(new cursorOperations.MoveTo(offset - lineFlowBoxLevelPosition.getSelectableOffset() + lineFlowBox.getSelectableSize() - 1));
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
      transformation.setLeftAnchor(leftAnchor);
      const targetLineSelectableOffset = nextLineFlowBox.resolveViewportPositionToSelectableOffset(leftAnchor);
      transformation.addOperation(new cursorOperations.MoveTo(offset - lineFlowBoxLevelPosition.getSelectableOffset() + lineFlowBox.getSelectableSize() + targetLineSelectableOffset));
    }
    return transformation;
  };
}
