import Editor from '../../Editor';
import Command from './Command';
import Transformation from '../Transformation';
import Translate from '../operations/Translate';

export default function moveForward(): Command {
  return (editor: Editor): Transformation => {
    const transformation = new Transformation();
    const editorCursor = editor.getEditorCursor();
    if (!editorCursor) {
      return transformation;
    }
    const anchor = editorCursor.getAnchor();
    const head = editorCursor.getHead();
    if (anchor === head) {
      const documentSize = editor.getDoc().getSize();
      if (head >= documentSize - 1) {
        return transformation;
      }
      transformation.addOperation(new Translate(1));
    } else {
      if (anchor < head) {
        transformation.addOperation(new Translate(0));
      } else if (anchor > head) {
        transformation.addOperation(new Translate(anchor - head));
      }
    }
    return transformation;
  };
}
