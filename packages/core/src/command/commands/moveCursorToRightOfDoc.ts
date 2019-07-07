import Editor from '../../Editor';
import Transformation from '../../transform/Transformation';
import Command from '../Command';

export default function moveToRightOfDoc(): Command {
  return (editor: Editor): Transformation => {
    const transformation = new Transformation();
    const cursor = editor.getCursor();
    if (!cursor) {
      return transformation;
    }
    const docBox = editor.getLayoutManager().getDocBox();
    transformation.setCursor(docBox.getSize() - 1);
    return transformation;
  };
}
