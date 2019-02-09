import TaleWeaver from '../../TaleWeaver';
import CursorCommand from '../CursorCommand';
import CursorTransformation from '../../state/CursorTransformation';
import TranslateCursorHead from '../../state/cursortransformationsteps/TranslateCursorHead';
import moveToLineStart from './moveToLineStart';

export default function moveHeadToNextLine(): CursorCommand {
  return (taleWeaver: TaleWeaver): CursorTransformation => {
    const transformation = new CursorTransformation();
    const editorCursor = taleWeaver.getState().getEditorCursor();
    if (!editorCursor) {
      return transformation;
    }
    const documentView = taleWeaver.getDocumentView();
    const position = editorCursor.getHead();
    const resolvedPosition = documentView.resolvePosition(position);
    const lineView = resolvedPosition.lineView;
    const nextLineView = lineView.getNextLineView();
    if (!nextLineView) {
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
      lineViewX = lineView.getScreenSelection(resolvedPosition.lineViewPosition, resolvedPosition.lineViewPosition).x1;
    }
    const nextLineViewPosition = nextLineView.getDocumentPosition(lineViewX);
    const newPosition = position - resolvedPosition.lineViewPosition + lineView.getSize() + nextLineViewPosition;
    transformation.addStep(new TranslateCursorHead(newPosition - editorCursor.getHead(), true));
    return transformation;
  };
}
