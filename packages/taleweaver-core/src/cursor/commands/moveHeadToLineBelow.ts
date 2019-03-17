import CursorExtension from '../CursorExtension';
import Command from '../Command';
import Transformation from '../Transformation';
import { MoveHeadTo } from '../operations'
import LineBox from '../../layout/LineBox';

export default function moveHeadToLineBelow(): Command {
  return (cursorExtension: CursorExtension): Transformation => {
    const transformation = new Transformation();
    const cursor = cursorExtension.getCursor();
    if (!cursor) {
      return transformation;
    }
    const offset = cursor.getHead();
    const provider = cursorExtension.getProvider();
    const docLayout = provider.getDocLayout();
    const position = docLayout.resolvePosition(offset);
    const lineBoxLevelPosition = position.getLineBoxLevel();
    const lineBox = lineBoxLevelPosition.getLayoutNode();
    if (!(lineBox instanceof LineBox)) {
      throw new Error(`Expecting position to be referencing an line box.`);
    }
    const nextLineBox = lineBox.getNextSibling();
    if (!nextLineBox) {
      transformation.addOperation(new MoveHeadTo(offset - lineBoxLevelPosition.getSelectableOffset() + lineBox.getSelectableSize() - 1));
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
      const targetLineSelectableOffset = nextLineBox.resolveViewportPositionToSelectableOffset(leftAnchor);
      transformation.addOperation(new MoveHeadTo(offset - lineBoxLevelPosition.getSelectableOffset() + lineBox.getSelectableSize() + targetLineSelectableOffset));
    }
    return transformation;
  };
}
