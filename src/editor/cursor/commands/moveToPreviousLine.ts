import TaleWeaver from '../../TaleWeaver';
import Command from './Command';
import Transformation from '../Transformation';
import Translate from '../operations/Translate';
import moveToLineStart from './moveToLineStart';

export default function moveToPreviousLine(): Command {
  return (taleWeaver: TaleWeaver): Transformation => {
    const transformation = new Transformation(true);
    const editorCursor = taleWeaver.getEditorCursor();
    if (!editorCursor) {
      return transformation;
    }
    const position = Math.min(editorCursor.getHead(), editorCursor.getAnchor());
    const docView = taleWeaver.getDocView();
    const viewAwarePosition = docView.resolveModelPosition(position);
    const previousLineView = viewAwarePosition.lineView.getPreviousLineView();
    if (!previousLineView) {
      return moveToLineStart()(taleWeaver);
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
    transformation.addOperation(new Translate(0 - viewAwarePosition.lineViewPosition - previousLineView.getSize() + previousLinePosition));
    return transformation;
  };
}
