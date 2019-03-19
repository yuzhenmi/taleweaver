import CursorExtension from '../CursorExtension';
import Command from '../Command';
import Transformation from '../Transformation';
import { MoveTo, MoveHeadTo } from '../operations'

export default function selectAll(): Command {
  return (cursorExtension: CursorExtension): Transformation => {
    const transformation = new Transformation();
    const cursor = cursorExtension.getCursor();
    if (!cursor) {
      return transformation;
    }
    const provider = cursorExtension.getProvider();
    const docLayout = provider.getDocLayout();
    transformation.addOperation(new MoveTo(0));
    transformation.addOperation(new MoveHeadTo(docLayout.getSelectableSize() - 1));
    return transformation;
  };
}
