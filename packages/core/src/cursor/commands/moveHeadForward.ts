import Editor from '../../Editor';
import Command from './Command';
import Transformation from '../Transformation';
import TranslateHead from '../operations/TranslateHead';

export default function moveHeadForward(): Command {
  return (editor: Editor): Transformation => {
    const transformation = new Transformation();
    const editorCursor = editor.getEditorCursor();
    if (!editorCursor) {
      return transformation;
    }
    if (editorCursor.getHead() >= editor.getDoc().getSize() - 1) {
      return transformation;
    }
    transformation.addOperation(new TranslateHead(1));
    return transformation;
  };
}
