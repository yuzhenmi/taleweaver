import {
  Editor,
  CursorCommand,
  CursorTransformation,
  LineBox,
  cursorOperations,
} from '@taleweaver/core';
import CursorExtension from '../CursorExtension';

export default function moveHeadToLineBelow(cursorExtension: CursorExtension): CursorCommand {
  return (editor: Editor): CursorTransformation => {
    const transformation = new CursorTransformation();
    const cursor = editor.getCursor();
    if (!cursor) {
      return transformation;
    }
    const offset = cursor.getHead();
    const docBox = editor.getLayoutEngine().getDocBox();
    const position = docBox.resolvePosition(offset);
    const lineBoxLevelPosition = position.getLineBoxLevel();
    const lineBox = lineBoxLevelPosition.getLayoutNode();
    if (!(lineBox instanceof LineBox)) {
      throw new Error(`Expecting position to be referencing an line box.`);
    }
    const nextLineBox = lineBox.getNextSibling();
    if (!nextLineBox) {
      transformation.addOperation(new cursorOperations.MoveHeadTo(offset - lineBoxLevelPosition.getSelectableOffset() + lineBox.getSelectableSize() - 1));
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
      transformation.addOperation(new cursorOperations.MoveHeadTo(offset - lineBoxLevelPosition.getSelectableOffset() + lineBox.getSelectableSize() + targetLineSelectableOffset));
    }
    return transformation;
  };
}
