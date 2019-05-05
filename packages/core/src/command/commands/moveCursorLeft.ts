import Editor from '../../Editor';
import Transformation from '../../transform/Transformation';
import Command from '../Command';

export default function moveLeft(): Command {
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
      transformation.setCursor(head - 1);
    } else {
      if (anchor < head) {
        transformation.setCursor(anchor);
      } else if (anchor > head) {
        transformation.setCursor(head);
      }
    }
    return transformation;
  };
}
