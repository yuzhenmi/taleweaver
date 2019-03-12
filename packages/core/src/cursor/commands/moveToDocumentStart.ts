import Editor from '../../Editor';
import Command from './Command';
import Transformation from '../Transformation';
import Translate from '../operations/Translate';

export default function moveToDocumentStart(): Command {
  return (editor: Editor): Transformation => {
    const transformation = new Transformation();
    const editorCursor = editor.getEditorCursor();
    if (!editorCursor) {
      return transformation;
    }
    const head = editorCursor.getHead();
    transformation.addOperation(new Translate(0 - head));
    return transformation;
  };
}
