import TaleWeaver from '../TaleWeaver';
import CursorCommand from './CursorCommand';
import Transformation from '../cursor/Transformation';
import Translate from '../cursor/transformationsteps/Translate';

export default function moveForwardByWord(): CursorCommand {
  return (taleWeaver: TaleWeaver): Transformation => {
    const transformation = new Transformation();
    const editorCursor = taleWeaver.getEditorCursor();
    if (!editorCursor) {
      return transformation;
    }
    const head = editorCursor.getHead();
    const docView = taleWeaver.getDocView();
    const viewAwarePosition = docView.resolveModelPosition(head);
    if (viewAwarePosition.wordViewPosition < viewAwarePosition.wordView.getSize()) {
      transformation.addStep(new Translate(viewAwarePosition.wordView.getSize() - viewAwarePosition.wordViewPosition));
    } else {
      const nextWordView = viewAwarePosition.wordView.getNextWordView();
      if (nextWordView) {
        transformation.addStep(new Translate(nextWordView.getSize()));
      }
    }
    return transformation;
  };
}
