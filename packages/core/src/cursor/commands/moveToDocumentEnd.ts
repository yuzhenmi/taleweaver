import Editor from '../../Editor';
import Command from './Command';
import Transformation from '../Transformation';
import Translate from '../operations/Translate';

export default function moveToDocumentEnd(): Command {
  return (editor: Editor): Transformation => {
    const transformation = new Transformation();
    const editorCursor = editor.getEditorCursor();
    if (!editorCursor) {
      return transformation;
    }
    const head = editorCursor.getHead();
    const documentSize = editor.getDoc().getSize();
    transformation.addOperation(new Translate(documentSize - 1- head));
    return transformation;
  };
}
