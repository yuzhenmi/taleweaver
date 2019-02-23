import TaleWeaver from '../TaleWeaver';
import CursorCommand from './CursorCommand';
import Transformation from '../cursor/Transformation';
import Translate from '../cursor/transformationsteps/Translate';

export default function moveBackwardByWord(): CursorCommand {
  return (taleWeaver: TaleWeaver): Transformation => {
    const transformation = new Transformation();
    const editorCursor = taleWeaver.getEditorCursor();
    if (!editorCursor) {
      return transformation;
    }
    const head = editorCursor.getHead();
    const docView = taleWeaver.getDocView();
    const viewAwarePosition = docView.resolveModelPosition(head);
    if (viewAwarePosition.wordViewPosition > 0) {
      transformation.addStep(new Translate(0 - viewAwarePosition.wordViewPosition));
    } else {
      const previousWordView = viewAwarePosition.wordView.getPreviousWordView();
      if (previousWordView) {
        transformation.addStep(new Translate(0 - previousWordView.getSize()));
      }
    }
    return transformation;
  };
}
