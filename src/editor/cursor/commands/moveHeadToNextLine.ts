import TaleWeaver from '../../TaleWeaver';
import Command from './Command';
import Transformation from '../Transformation';
import TranslateHead from '../operations/TranslateHead';
import moveHeadToLineEnd from './moveHeadToLineEnd';

export default function moveHeadToNextLine(): Command {
  return (taleWeaver: TaleWeaver): Transformation => {
    const transformation = new Transformation(true);
    const editorCursor = taleWeaver.getEditorCursor();
    if (!editorCursor) {
      return transformation;
    }
    const head = editorCursor.getHead();
    const docView = taleWeaver.getDocView();
    const viewAwarePosition = docView.resolveModelPosition(head);
    const nextLineView = viewAwarePosition.lineView.getNextLineView();
    if (!nextLineView) {
      return moveHeadToLineEnd()(taleWeaver);
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
    const nextLinePosition = nextLineView.mapViewPositionToModelPosition(lineViewX);
    transformation.addOperation(new TranslateHead(viewAwarePosition.lineView.getSize() - viewAwarePosition.lineViewPosition + nextLinePosition));
    return transformation;
  };
}
