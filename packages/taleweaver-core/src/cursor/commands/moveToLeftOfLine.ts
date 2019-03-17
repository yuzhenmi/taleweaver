import CursorExtension from '../CursorExtension';
import Command from '../Command';
import Transformation from '../Transformation';
import { MoveTo } from '../operations'

export default function moveToLeftOfLine(): Command {
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
      transformation.addOperation(new MoveTo(head - lineBoxLevelPosition.getSelectableOffset()));
    } else {
      transformation.addOperation(new MoveTo(head));
    }
    return transformation;
  };
}
