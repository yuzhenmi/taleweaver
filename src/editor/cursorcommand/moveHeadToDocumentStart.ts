import TaleWeaver from '../TaleWeaver';
import CursorCommand from './CursorCommand';
import Transformation from '../cursor/Transformation';
import TranslateHead from '../cursor/transformationsteps/TranslateHead';

export default function moveHeadToDocumentStart(): CursorCommand {
  return (taleWeaver: TaleWeaver): Transformation => {
    const transformation = new Transformation();
    const editorCursor = taleWeaver.getEditorCursor();
    if (!editorCursor) {
      return transformation;
    }
    const head = editorCursor.getHead();
    transformation.addStep(new TranslateHead(0 - head));
    return transformation;
  };
}
