import TaleWeaver from '../TaleWeaver';
import CursorCommand from './CursorCommand';
import Transformation from '../cursor/Transformation';
import Translate from '../cursor/transformationsteps/Translate';

export default function moveForward(): CursorCommand {
  return (taleWeaver: TaleWeaver): Transformation => {
    const transformation = new Transformation();
    const editorCursor = taleWeaver.getEditorCursor();
    if (!editorCursor) {
      return transformation;
    }
    const anchor = editorCursor.getAnchor();
    const head = editorCursor.getHead();
    if (anchor === head) {
      const documentSize = taleWeaver.getDoc().getSize();
      if (head >= documentSize - 1) {
        return transformation;
      }
      transformation.addStep(new Translate(1));
    } else {
      if (anchor < head) {
        transformation.addStep(new Translate(0));
      } else if (anchor > head) {
        transformation.addStep(new Translate(anchor - head));
      }
    }
    return transformation;
  };
}
