import TaleWeaver from '../../TaleWeaver';
import CursorCommand from '../CursorCommand';
import CursorTransformation from '../../state/CursorTransformation';
import TranslateCursor from '../../state/cursortransformationsteps/TranslateCursor';

export default function moveBackward(): CursorCommand {
  return (taleWeaver: TaleWeaver): CursorTransformation => {
    const transformation = new CursorTransformation();
    const editorCursor = taleWeaver.getEditorCursor();
    if (!editorCursor) {
      return transformation;
    }
    const anchor = editorCursor.getAnchor();
    const head = editorCursor.getHead();
    if (anchor === head) {
      if (head < 1) {
        return transformation;
      }
      transformation.addStep(new TranslateCursor(-1));
    } else {
      if (anchor < head) {
        transformation.addStep(new TranslateCursor(anchor - head));
      } else if (anchor > head) {
        transformation.addStep(new TranslateCursor(0));
      }
    }
    return transformation;
  };
}
