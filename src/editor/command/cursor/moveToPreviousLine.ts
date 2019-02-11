import TaleWeaver from '../../TaleWeaver';
import CursorCommand from '../CursorCommand';
import CursorTransformation from '../../state/CursorTransformation';
import TranslateCursor from '../../state/cursortransformationsteps/TranslateCursor';
import moveToLineStart from './moveToLineStart';

export default function moveToPreviousLine(): CursorCommand {
  return (taleWeaver: TaleWeaver): CursorTransformation => {
    const transformation = new CursorTransformation();
    const editorCursor = taleWeaver.getState().getEditorCursor();
    if (!editorCursor) {
      return transformation;
    }
    const position = Math.min(editorCursor.getHead(), editorCursor.getAnchor());
    const documentView = taleWeaver.getDocumentView();
    const viewAwarePosition = documentView.resolveModelPosition(position);
    const previousLineView = viewAwarePosition.lineView.getPreviousLineView();
    if (!previousLineView) {
      return moveToLineStart()(taleWeaver);
    }
    const editorCursorView = documentView.getEditorCursorView();
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
    transformation.addStep(new TranslateCursor(0 - viewAwarePosition.lineViewPosition - previousLineView.getSize() + previousLinePosition, true));
    return transformation;
  };
}
