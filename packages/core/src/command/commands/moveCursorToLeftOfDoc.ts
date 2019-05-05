import Editor from '../../Editor';
import Transformation from '../../transform/Transformation';
import Command from '../Command';

export default function moveToLeftOfDoc(): Command {
  return (editor: Editor): Transformation => {
    const transformation = new Transformation();
    const cursor = editor.getCursor();
    if (!cursor) {
      return transformation;
    }
    transformation.setCursor(0);
    return transformation;
  };
}
