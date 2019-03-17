import CursorExtension from '../CursorExtension';
import Command from '../Command';
import Transformation from '../Transformation';
import { MoveHeadTo } from '../operations'

export default function moveHeadToRightOfDoc(): Command {
  return (cursorExtension: CursorExtension): Transformation => {
    const transformation = new Transformation();
    const cursor = cursorExtension.getCursor();
    if (!cursor) {
      return transformation;
    }
    const provider = cursorExtension.getProvider();
    const docLayout = provider.getDocLayout();
    transformation.addOperation(new MoveHeadTo(docLayout.getSelectableSize() - 2));
    return transformation;
  };
}
