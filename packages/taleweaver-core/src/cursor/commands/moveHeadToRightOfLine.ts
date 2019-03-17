import CursorExtension from '../CursorExtension';
import Command from '../Command';
import Transformation from '../Transformation';
import { MoveHeadTo } from '../operations'
import LineBox from '../../layout/LineBox';

export default function moveHeadToRightOfLine(): Command {
  return (cursorExtension: CursorExtension): Transformation => {
    const transformation = new Transformation();
    const cursor = cursorExtension.getCursor();
    if (!cursor) {
      return transformation;
    }
    const head = cursor.getHead();
    const provider = cursorExtension.getProvider();
    const docLayout = provider.getDocLayout();
    const position = docLayout.resolvePosition(head);
    const lineBoxLevelPosition = position.getLineBoxLevel();
    const lineBox = lineBoxLevelPosition.getLayoutNode();
    if (!(lineBox instanceof LineBox)) {
      throw new Error(`Expecting position to be referencing an line box.`);
    }
    if (lineBoxLevelPosition.getSelectableOffset() < lineBox.getSelectableSize() - 1) {
      transformation.addOperation(new MoveHeadTo(head - lineBoxLevelPosition.getSelectableOffset() + lineBox.getSelectableSize() - 1));
    } else {
      transformation.addOperation(new MoveHeadTo(head));
    }
    return transformation;
  };
}
