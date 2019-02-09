import TaleWeaver from '../../TaleWeaver';
import CursorCommand from '../CursorCommand';
import CursorTransformation from '../../state/CursorTransformation';
import TranslateCursorHead from '../../state/cursortransformationsteps/TranslateCursorHead';
import moveHeadToLineStart from './moveHeadToLineStart';

export default function moveHeadToPreviousLine(): CursorCommand {
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
    const previousLineView = lineView.getPreviousLineView();
    if (!previousLineView) {
      return moveHeadToLineStart()(taleWeaver);
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
    const previousLineViewPosition = previousLineView.getDocumentPosition(lineViewX);
    const newPosition = position - resolvedPosition.lineViewPosition - previousLineView.getSize() + previousLineViewPosition;
    transformation.addStep(new TranslateCursorHead(newPosition - editorCursor.getHead(), true));
    return transformation;
  };
}
