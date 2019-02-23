import TaleWeaver from '../TaleWeaver';
import CursorCommand from './CursorCommand';
import Transformation from '../cursor/Transformation';
import TranslateHead from '../cursor/transformationsteps/TranslateHead';

export default function moveHeadToLineStart(): CursorCommand {
  return (taleWeaver: TaleWeaver): Transformation => {
    const transformation = new Transformation();
    const editorCursor = taleWeaver.getEditorCursor();
    if (!editorCursor) {
      return transformation;
    }
    const head = editorCursor.getHead();
    const docView = taleWeaver.getDocView();
    const viewAwarePosition = docView.resolveModelPosition(head);
    if (viewAwarePosition.lineViewPosition > 0) {
      transformation.addStep(new TranslateHead(0 - viewAwarePosition.lineViewPosition));
    }
    return transformation;
  };
}
