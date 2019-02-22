import TaleWeaver from '../TaleWeaver';
import CursorCommand from './CursorCommand';
import CursorTransformation from '../cursortransformer/CursorTransformation';
import TranslateCursor from '../cursortransformer/steps/TranslateCursor';
import moveToLineEnd from './moveToLineEnd';

export default function moveToNextLine(): CursorCommand {
  return (taleWeaver: TaleWeaver): CursorTransformation => {
    const transformation = new CursorTransformation();
    const editorCursor = taleWeaver.getEditorCursor();
    if (!editorCursor) {
      return transformation;
    }
    const position = Math.max(editorCursor.getHead(), editorCursor.getAnchor());
    const docView = taleWeaver.getDocView();
    const viewAwarePosition = docView.resolveModelPosition(position);
    const nextLineView = viewAwarePosition.lineView.getNextLineView();
    if (!nextLineView) {
      return moveToLineEnd()(taleWeaver);
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
    transformation.addStep(new TranslateCursor(viewAwarePosition.lineView.getSize() - viewAwarePosition.lineViewPosition + nextLinePosition, true));
    return transformation;
  };
}
