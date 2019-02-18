import TaleWeaver from '../../TaleWeaver';
import CursorCommand from '../CursorCommand';
import CursorTransformation from '../../transform/CursorTransformation';
import TranslateCursorHead from '../../transform/cursortransformationsteps/TranslateCursorHead';

export default function moveHeadTo(position: number): CursorCommand {
  return (taleWeaver: TaleWeaver): CursorTransformation => {
    const transformation = new CursorTransformation();
    const editorCursor = taleWeaver.getEditorCursor();
    if (!editorCursor) {
      return transformation;
    }
    transformation.addStep(new TranslateCursorHead(position - editorCursor.getHead()));
    return transformation;
  };
}
