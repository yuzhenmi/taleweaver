import TaleWeaver from '../../TaleWeaver';
import CursorCommand from '../CursorCommand';
import CursorTransformation from '../../transform/CursorTransformation';
import TranslateCursor from '../../transform/cursortransformationsteps/TranslateCursor';

export default function moveForwardByWord(): CursorCommand {
  return (taleWeaver: TaleWeaver): CursorTransformation => {
    const transformation = new CursorTransformation();
    const editorCursor = taleWeaver.getEditorCursor();
    if (!editorCursor) {
      return transformation;
    }
    const head = editorCursor.getHead();
    const docView = taleWeaver.getDocView();
    const viewAwarePosition = docView.resolveModelPosition(head);
    if (viewAwarePosition.wordViewPosition < viewAwarePosition.wordView.getSize()) {
      transformation.addStep(new TranslateCursor(viewAwarePosition.wordView.getSize() - viewAwarePosition.wordViewPosition));
    } else {
      const nextWordView = viewAwarePosition.wordView.getNextWordView();
      if (nextWordView) {
        transformation.addStep(new TranslateCursor(nextWordView.getSize()));
      }
    }
    return transformation;
  };
}
