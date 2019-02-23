import TaleWeaver from '../TaleWeaver';
import CursorCommand from './CursorCommand';
import Transformation from '../cursor/Transformation';
import TranslateHead from '../cursor/transformationsteps/TranslateHead';

export default function moveHeadTo(position: number): CursorCommand {
  return (taleWeaver: TaleWeaver): Transformation => {
    const transformation = new Transformation();
    const editorCursor = taleWeaver.getEditorCursor();
    if (!editorCursor) {
      return transformation;
    }
    transformation.addStep(new TranslateHead(position - editorCursor.getHead()));
    return transformation;
  };
}
