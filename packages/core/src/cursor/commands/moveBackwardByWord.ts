import Editor from '../../Editor';
import Command from './Command';
import Transformation from '../Transformation';
import Translate from '../operations/Translate';

export default function moveBackwardByWord(): Command {
  return (editor: Editor): Transformation => {
    const transformation = new Transformation();
    const editorCursor = editor.getEditorCursor();
    if (!editorCursor) {
      return transformation;
    }
    const head = editorCursor.getHead();
    const docView = editor.getDocView();
    const viewAwarePosition = docView.resolveModelPosition(head);
    if (viewAwarePosition.wordViewPosition > 0) {
      transformation.addOperation(new Translate(0 - viewAwarePosition.wordViewPosition));
    } else {
      const previousWordView = viewAwarePosition.wordView.getPreviousWordView();
      if (previousWordView) {
        transformation.addOperation(new Translate(0 - previousWordView.getSize()));
      }
    }
    return transformation;
  };
}
