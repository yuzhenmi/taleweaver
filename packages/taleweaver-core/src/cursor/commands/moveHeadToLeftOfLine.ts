import CursorExtension from '../CursorExtension';
import Command from '../Command';
import Transformation from '../Transformation';
import { MoveHeadTo } from '../operations'

export default function moveHeadToLeftOfLine(): Command {
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
    if (lineBoxLevelPosition.getSelectableOffset() > 0) {
      transformation.addOperation(new MoveHeadTo(head - lineBoxLevelPosition.getSelectableOffset()));
    } else {
      transformation.addOperation(new MoveHeadTo(head));
    }
    return transformation;
  };
}
