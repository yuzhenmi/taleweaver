import TaleWeaver from '../../TaleWeaver';
import Command from './Command';
import Transformation from '../Transformation';
import TranslateHead from '../operations/TranslateHead';
import moveHeadToLineStart from './moveHeadToLineStart';

export default function moveHeadToPreviousLine(): Command {
  return (taleWeaver: TaleWeaver): Transformation => {
    const transformation = new Transformation(true);
    const editorCursor = taleWeaver.getEditorCursor();
    if (!editorCursor) {
      return transformation;
    }
    const head = editorCursor.getHead();
    const docView = taleWeaver.getDocView();
    const viewAwarePosition = docView.resolveModelPosition(head);
    const previousLineView = viewAwarePosition.lineView.getPreviousLineView();
    if (!previousLineView) {
      return moveHeadToLineStart()(taleWeaver);
    }
    const editorCursorView = docView.getEditorCursorView();
    if (!editorCursorView) {
      return transformation;
    }
    let lineViewX: number;
    if (editorCursorView.getLineViewX() !== null) {
      lineViewX = editorCursorView.getLineViewX()!;
    } else {
      lineViewX = viewAwarePosition.lineView.mapModelPositionRangeToViewPositionBox(
        viewAwarePosition.lineViewPosition,
        viewAwarePosition.lineViewPosition,
      ).x1;
    }
    const previousLinePosition = previousLineView.mapViewPositionToModelPosition(lineViewX);
    transformation.addOperation(new TranslateHead(0 - viewAwarePosition.lineViewPosition - previousLineView.getSize() + previousLinePosition));
    return transformation;
  };
}
