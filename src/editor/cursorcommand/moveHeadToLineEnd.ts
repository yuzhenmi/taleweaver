import TaleWeaver from '../TaleWeaver';
import CursorCommand from './CursorCommand';
import CursorTransformation from '../cursortransformer/CursorTransformation';
import TranslateCursorHead from '../cursortransformer/steps/TranslateCursorHead';

export default function moveHeadRightByLine(): CursorCommand {
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
      transformation.addStep(new TranslateCursorHead(viewAwarePosition.lineView.getSize() - 1 - viewAwarePosition.lineViewPosition));
    }
    return transformation;
  };
}
