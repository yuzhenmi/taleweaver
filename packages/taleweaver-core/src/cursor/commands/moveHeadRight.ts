import CursorExtension from '../CursorExtension';
import Command from '../Command';
import Transformation from '../Transformation';
import { MoveHeadTo } from '../operations'

export default function moveHeadLeft(): Command {
  return (cursorExtension: CursorExtension): Transformation => {
    const transformation = new Transformation();
    const cursor = cursorExtension.getCursor();
    if (!cursor) {
      return transformation;
    }
    const head = cursor.getHead();
    if (head >= cursorExtension.getProvider().getDocSelectableSize() - 1) {
      return transformation;
    }
    transformation.addOperation(new MoveHeadTo(cursor.getHead() + 1));
    return transformation;
  };
}
