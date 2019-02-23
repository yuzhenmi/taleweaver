import TaleWeaver from '../TaleWeaver';
import CursorCommand from './CursorCommand';
import Transformation from '../cursor/Transformation';
import TranslateHead from '../cursor/transformationsteps/TranslateHead';

export default function moveHeadForward(): CursorCommand {
  return (taleWeaver: TaleWeaver): Transformation => {
    const transformation = new Transformation();
    const editorCursor = taleWeaver.getEditorCursor();
    if (!editorCursor) {
      return transformation;
    }
    if (editorCursor.getHead() >= taleWeaver.getDoc().getSize() - 1) {
      return transformation;
    }
    transformation.addStep(new TranslateHead(1));
    return transformation;
  };
}
