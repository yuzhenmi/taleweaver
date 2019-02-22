import TaleWeaver from '../TaleWeaver';
import CursorCommand from './CursorCommand';
import CursorTransformation from '../cursortransformer/CursorTransformation';
import TranslateCursor from '../cursortransformer/steps/TranslateCursor';
import moveToLineStart from './moveToLineStart';

export default function moveToPreviousLine(): CursorCommand {
  return (taleWeaver: TaleWeaver): CursorTransformation => {
    const transformation = new CursorTransformation();
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
    transformation.addStep(new TranslateCursor(0 - viewAwarePosition.lineViewPosition - previousLineView.getSize() + previousLinePosition, true));
    return transformation;
  };
}
