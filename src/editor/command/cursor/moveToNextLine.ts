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
    const documentView = taleWeaver.getDocumentView();
    const position = Math.max(editorCursor.getHead(), editorCursor.getAnchor());
    const resolvedPosition = documentView.resolvePosition(position);
    const lineView = resolvedPosition.lineView;
    const nextLineView = lineView.getNextLineView();
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
      lineViewX = lineView.getScreenSelection(resolvedPosition.lineViewPosition, resolvedPosition.lineViewPosition).x1;
    }
    const nextLineViewPosition = nextLineView.getDocumentPosition(lineViewX);
    const newPosition = position - resolvedPosition.lineViewPosition + lineView.getSize() + nextLineViewPosition;
    transformation.addStep(new TranslateCursor(newPosition - editorCursor.getHead(), true));
    return transformation;
  };
}
