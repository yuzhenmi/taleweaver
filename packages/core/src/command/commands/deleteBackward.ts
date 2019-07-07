import Editor from '../../Editor';
import Transformation from '../../transform/Transformation';
import { Delete } from '../../transform/operations';
import Command from '../Command';

export default function deleteBackward(): Command {
  return (editor: Editor): Transformation => {
    const transformation = new Transformation();
    const cursor = editor.getCursor();
    if (!cursor) {
      return transformation;
    }
    const anchor = cursor.getAnchor();
    const head = cursor.getHead();
    if (anchor === head) {
      if (head < 1) {
        return transformation;
      }
      transformation.addOperation(new Delete(
        editor.getRenderManager().getModelOffset(head - 1),
        editor.getRenderManager().getModelOffset(head),
      ));
      transformation.setCursor(head - 1);
    } else {
      if (anchor < head) {
        transformation.addOperation(new Delete(
          editor.getRenderManager().getModelOffset(anchor),
          editor.getRenderManager().getModelOffset(head),
        ));
        transformation.setCursor(anchor);
      } else if (anchor > head) {
        transformation.addOperation(new Delete(
          editor.getRenderManager().getModelOffset(head),
          editor.getRenderManager().getModelOffset(anchor),
        ));
        transformation.setCursor(head);
      }
    }
    return transformation;
  };
}
