import CursorExtension from '../CursorExtension';
import Command from '../Command';
import Transformation from '../Transformation';
import { MoveHeadTo } from '../operations'

export default function moveHeadToLeftOfDoc(): Command {
  return (cursorExtension: CursorExtension): Transformation => {
    const transformation = new Transformation();
    const cursor = cursorExtension.getCursor();
    if (!cursor) {
      return transformation;
    }
    transformation.addOperation(new MoveHeadTo(0));
    return transformation;
  };
}
