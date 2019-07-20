import Editor from '../../Editor';
import LineFlowBox from '../../layout/LineLayoutNode';
import Transformation from '../../transform/Transformation';
import Command from '../Command';

export default function moveToLineAbove(): Command {
  return (editor: Editor): Transformation => {
    const transformation = new Transformation();
    const cursor = editor.getCursor();
    if (!cursor) {
      return transformation;
    }
    const offset = Math.min(cursor.getAnchor(), cursor.getHead());
    const docBox = editor.getLayoutManager().getDocBox();
    const position = docBox.resolvePosition(offset);
    const lineFlowBoxLevelPosition = position.getLineFlowBoxLevel();
    const lineFlowBox = lineFlowBoxLevelPosition.getLayoutNode();
    if (!(lineFlowBox instanceof LineFlowBox)) {
      throw new Error(`Expecting position to be referencing an line box.`);
    }
    const previousLineFlowBox = lineFlowBox.getPreviousSibling();
    if (!previousLineFlowBox) {
      transformation.setCursor(offset - lineFlowBoxLevelPosition.getSelectableOffset());
    } else {
      let leftLock = cursor.getLeftLock();
      if (leftLock === null) {
        leftLock = lineFlowBox.resolveSelectableOffsetRangeToViewportBoundingRects(
          lineFlowBoxLevelPosition.getSelectableOffset(),
          lineFlowBoxLevelPosition.getSelectableOffset(),
        )[0].left;
      }
      transformation.setCursorLockLeft(leftLock);
      const targetLineSelectableOffset = previousLineFlowBox.resolveViewportPositionToSelectableOffset(leftLock);
      transformation.setCursor(offset - lineFlowBoxLevelPosition.getSelectableOffset() - previousLineFlowBox.getSelectableSize() + targetLineSelectableOffset);
    }
    return transformation;
  };
}
