import TaleWeaver from '../../TaleWeaver';
import CursorCommand from '../CursorCommand';
import CursorTransformation from '../../transform/CursorTransformation';
import TranslateCursorHead from '../../transform/cursortransformationsteps/TranslateCursorHead';

export default function moveHeadBackwardByWord(): CursorCommand {
  return (taleWeaver: TaleWeaver): CursorTransformation => {
    const transformation = new CursorTransformation();
    const editorCursor = taleWeaver.getEditorCursor();
    if (!editorCursor) {
      return transformation;
    }
    const head = editorCursor.getHead();
    const docView = taleWeaver.getDocView();
    const viewAwarePosition = docView.resolveModelPosition(head);
    if (viewAwarePosition.wordViewPosition > 0) {
      transformation.addStep(new TranslateCursorHead(0 - viewAwarePosition.wordViewPosition));
    } else {
      const previousWordView = viewAwarePosition.wordView.getPreviousWordView();
      if (previousWordView) {
        transformation.addStep(new TranslateCursorHead(0 - previousWordView.getSize()));
      }
    }
    return transformation;
  };
}
