import Editor from '../../Editor';
import Command from './Command';
import Transformation from '../Transformation';
import Translate from '../operations/Translate';
import moveToLineEnd from './moveToLineEnd';

export default function moveToNextLine(): Command {
  return (editor: Editor): Transformation => {
    const transformation = new Transformation(true);
    const editorCursor = editor.getEditorCursor();
    if (!editorCursor) {
      return transformation;
    }
    const position = Math.max(editorCursor.getHead(), editorCursor.getAnchor());
    const docView = editor.getDocView();
    const viewAwarePosition = docView.resolveModelPosition(position);
    const nextLineView = viewAwarePosition.lineView.getNextLineView();
    if (!nextLineView) {
      return moveToLineEnd()(editor);
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
    transformation.addOperation(new Translate(viewAwarePosition.lineView.getSize() - viewAwarePosition.lineViewPosition + nextLinePosition));
    return transformation;
  };
}
