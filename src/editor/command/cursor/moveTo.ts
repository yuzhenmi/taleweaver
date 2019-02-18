import TaleWeaver from '../../TaleWeaver';
import CursorCommand from '../CursorCommand';
import CursorTransformation from '../../transform/CursorTransformation';
import TranslateCursor from '../../transform/cursortransformationsteps/TranslateCursor';

export default function moveTo(position: number): CursorCommand {
  return (taleWeaver: TaleWeaver): CursorTransformation => {
    const transformation = new CursorTransformation();
    const editorCursor = taleWeaver.getEditorCursor();
    if (!editorCursor) {
      return transformation;
    }
    transformation.addStep(new TranslateCursor(position - editorCursor.getHead()));
    return transformation;
  };
}
