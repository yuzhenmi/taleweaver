import TaleWeaver from '../TaleWeaver';
import CursorCommand from './CursorCommand';
import CursorTransformation from '../cursortransformer/CursorTransformation';
import TranslateCursor from '../cursortransformer/steps/TranslateCursor';

export default function moveForward(): CursorCommand {
  return (taleWeaver: TaleWeaver): CursorTransformation => {
    const transformation = new CursorTransformation();
    const editorCursor = taleWeaver.getEditorCursor();
    if (!editorCursor) {
      return transformation;
    }
    const anchor = editorCursor.getAnchor();
    const head = editorCursor.getHead();
    if (anchor === head) {
      const documentSize = taleWeaver.getDoc().getSize();
      if (head >= documentSize - 1) {
        return transformation;
      }
      transformation.addStep(new TranslateCursor(1));
    } else {
      if (anchor < head) {
        transformation.addStep(new TranslateCursor(0));
      } else if (anchor > head) {
        transformation.addStep(new TranslateCursor(anchor - head));
      }
    }
    return transformation;
  };
}
