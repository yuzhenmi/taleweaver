import CursorExtension from '../CursorExtension';
import Command from '../Command';
import Transformation from '../Transformation';
import { MoveTo } from '../operations'

export default function moveToRightOfDoc(): Command {
  return (cursorExtension: CursorExtension): Transformation => {
    const transformation = new Transformation();
    const cursor = cursorExtension.getCursor();
    if (!cursor) {
      return transformation;
    }
    const provider = cursorExtension.getProvider();
    const docLayout = provider.getDocLayout();
    transformation.addOperation(new MoveTo(docLayout.getSelectableSize() - 2));
    return transformation;
  };
}
