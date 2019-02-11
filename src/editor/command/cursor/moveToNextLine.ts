import TaleWeaver from '../../TaleWeaver';
import CursorCommand from '../CursorCommand';
import CursorTransformation from '../../state/CursorTransformation';
import TranslateCursor from '../../state/cursortransformationsteps/TranslateCursor';
import moveToLineEnd from './moveToLineEnd';

export default function moveToNextLine(): CursorCommand {
  return (taleWeaver: TaleWeaver): CursorTransformation => {
    const transformation = new CursorTransformation();
    const editorCursor = taleWeaver.getState().getEditorCursor();
    if (!editorCursor) {
      return transformation;
    }
    const position = Math.max(editorCursor.getHead(), editorCursor.getAnchor());
    const documentView = taleWeaver.getDocumentView();
    const viewAwarePosition = documentView.resolveModelPosition(position);
    console.log(viewAwarePosition);
    const nextLineView = viewAwarePosition.lineView.getNextLineView();
    if (!nextLineView) {
      return moveToLineEnd()(taleWeaver);
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
    const nextLinePosition = nextLineView.mapViewPositionToModelPosition(lineViewX);
    transformation.addStep(new TranslateCursor(viewAwarePosition.lineView.getSize() - viewAwarePosition.lineViewPosition + nextLinePosition, true));
    return transformation;
  };
}
