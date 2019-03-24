import {
  Editor,
  CursorCommand,
  CursorTransformation,
  LineBox,
  cursorOperations,
} from '@taleweaver/core';
import CursorExtension from '../CursorExtension';

export default function moveToLineAbove(cursorExtension: CursorExtension): CursorCommand {
  return (editor: Editor): CursorTransformation => {
    const transformation = new CursorTransformation();
    const cursor = editor.getCursor();
    if (!cursor) {
      return transformation;
    }
    const offset = Math.min(cursor.getAnchor(), cursor.getHead());
    const docBox = editor.getLayoutEngine().getDocBox();
    const position = docBox.resolvePosition(offset);
    const lineBoxLevelPosition = position.getLineBoxLevel();
    const lineBox = lineBoxLevelPosition.getLayoutNode();
    if (!(lineBox instanceof LineBox)) {
      throw new Error(`Expecting position to be referencing an line box.`);
    }
    const previousLineBox = lineBox.getPreviousSibling();
    if (!previousLineBox) {
      transformation.addOperation(new cursorOperations.MoveTo(offset - lineBoxLevelPosition.getSelectableOffset()));
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
      transformation.addOperation(new cursorOperations.MoveTo(offset - lineBoxLevelPosition.getSelectableOffset() - previousLineBox.getSelectableSize() + targetLineSelectableOffset));
    }
    return transformation;
  };
}
