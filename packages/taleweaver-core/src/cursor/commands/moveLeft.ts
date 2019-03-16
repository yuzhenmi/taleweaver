import CursorExtension from '../CursorExtension';
import Command from '../Command';
import Transformation from '../Transformation';
import { MoveTo } from '../operations'

export default function moveLeft(): Command {
  return (cursorExtension: CursorExtension): Transformation => {
    const transformation = new Transformation();
    const cursor = cursorExtension.getCursor();
    if (!cursor) {
      return transformation;
    }
    const anchor = cursor.getAnchor();
    const head = cursor.getHead();
    if (anchor === head) {
      if (head < 1) {
        return transformation;
      }
      transformation.addOperation(new MoveTo(cursor.getHead() - 1));
    } else {
      if (anchor < head) {
        transformation.addOperation(new MoveTo(cursor.getAnchor()));
      } else if (anchor > head) {
        transformation.addOperation(new MoveTo(cursor.getHead()));
      }
    }
    return transformation;
  };
}
