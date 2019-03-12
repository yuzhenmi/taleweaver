import Editor from '../../Editor';
import Command from './Command';
import Transformation from '../Transformation';
import Translate from '../operations/Translate';
import moveToLineStart from './moveToLineStart';

export default function moveToPreviousLine(): Command {
  return (editor: Editor): Transformation => {
    const transformation = new Transformation(true);
    const editorCursor = editor.getEditorCursor();
    if (!editorCursor) {
      return transformation;
    }
    const position = Math.min(editorCursor.getHead(), editorCursor.getAnchor());
    const docView = editor.getDocView();
    const viewAwarePosition = docView.resolveModelPosition(position);
    const previousLineView = viewAwarePosition.lineView.getPreviousLineView();
    if (!previousLineView) {
      return moveToLineStart()(editor);
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
