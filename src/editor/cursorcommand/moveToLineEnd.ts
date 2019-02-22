import TaleWeaver from '../TaleWeaver';
import CursorCommand from './CursorCommand';
import CursorTransformation from '../cursortransformer/CursorTransformation';
import TranslateCursor from '../cursortransformer/steps/TranslateCursor';

export default function moveToLineEnd(): CursorCommand {
  return (taleWeaver: TaleWeaver): CursorTransformation => {
    const transformation = new CursorTransformation();
    const editorCursor = taleWeaver.getEditorCursor();
    if (!editorCursor) {
      return transformation;
    }
    const head = editorCursor.getHead();
    const docView = taleWeaver.getDocView();
    const viewAwarePosition = docView.resolveModelPosition(head);
    if (viewAwarePosition.lineViewPosition < viewAwarePosition.lineView.getSize() - 1) {
      transformation.addStep(new TranslateCursor(viewAwarePosition.lineView.getSize() - 1 - viewAwarePosition.lineViewPosition));
    }
    return transformation;
  };
}
