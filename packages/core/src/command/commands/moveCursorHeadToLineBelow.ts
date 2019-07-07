import Editor from '../../Editor';
import Transformation from '../../transform/Transformation';
import LineFlowBox from '../../layout/LineFlowBox';
import Command from '../Command';

export default function moveHeadToLineBelow(): Command {
  return (editor: Editor): Transformation => {
    const transformation = new Transformation();
    const cursor = editor.getCursor();
    if (!cursor) {
      return transformation;
    }
    const offset = cursor.getHead();
    const docBox = editor.getLayoutManager().getDocBox();
    const position = docBox.resolvePosition(offset);
    const lineFlowBoxLevelPosition = position.getLineFlowBoxLevel();
    const lineFlowBox = lineFlowBoxLevelPosition.getLayoutNode();
    if (!(lineFlowBox instanceof LineFlowBox)) {
      throw new Error(`Expecting position to be referencing an line box.`);
    }
    const nextLineFlowBox = lineFlowBox.getNextSibling();
    if (!nextLineFlowBox) {
      transformation.setCursorHead(offset - lineFlowBoxLevelPosition.getOffset() + lineFlowBox.getSize() - 1);
    } else {
      let leftLock = cursor.getLeftLock();
      if (leftLock === null) {
        leftLock = lineFlowBox.resolveOffsetRangeToViewportBoundingRects(
          lineFlowBoxLevelPosition.getOffset(),
          lineFlowBoxLevelPosition.getOffset(),
        )[0].left;
      }
      transformation.setCursorLockLeft(leftLock);
      const targetLineSelectableOffset = nextLineFlowBox.resolveViewportPositionToSelectableOffset(leftLock);
      transformation.setCursorHead(offset - lineFlowBoxLevelPosition.getOffset() + lineFlowBox.getSize() + targetLineSelectableOffset);
    }
    return transformation;
  };
}
