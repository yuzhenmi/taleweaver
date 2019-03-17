import CursorExtension from '../CursorExtension';
import Command from '../Command';
import Transformation from '../Transformation';
import { MoveTo } from '../operations'
import LineBox from '../../layout/LineBox';

export default function moveToLineAbove(): Command {
  return (cursorExtension: CursorExtension): Transformation => {
    const transformation = new Transformation();
    const cursor = cursorExtension.getCursor();
    if (!cursor) {
      return transformation;
    }
    const offset = Math.min(cursor.getAnchor(), cursor.getHead());
    const provider = cursorExtension.getProvider();
    const docLayout = provider.getDocLayout();
    const position = docLayout.resolvePosition(offset);
    const lineBoxLevelPosition = position.getLineBoxLevel();
    const lineBox = lineBoxLevelPosition.getLayoutNode();
    if (!(lineBox instanceof LineBox)) {
      throw new Error(`Expecting position to be referencing an line box.`);
    }
    const previousLineBox = lineBox.getPreviousSibling();
    if (!previousLineBox) {
      transformation.addOperation(new MoveTo(offset - lineBoxLevelPosition.getSelectableOffset()));
    } else {
      let leftAnchor: number;
      if (cursorExtension.getLeftAnchor() !== null) {
        leftAnchor = cursorExtension.getLeftAnchor()!;
      } else {
        leftAnchor = lineBox.resolveSelectableOffsetRangeToViewportBoundingRects(
          lineBoxLevelPosition.getSelectableOffset(),
          lineBoxLevelPosition.getSelectableOffset(),
        )[0].left;
      }
      transformation.setLeftAnchor(leftAnchor);
      const targetLineSelectableOffset = previousLineBox.resolveViewportPositionToSelectableOffset(leftAnchor);
      transformation.addOperation(new MoveTo(offset - lineBoxLevelPosition.getSelectableOffset() - previousLineBox.getSelectableSize() + targetLineSelectableOffset));
    }
    return transformation;
  };
}
