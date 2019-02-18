import TaleWeaver from '../../TaleWeaver';
import CursorCommand from '../CursorCommand';
import CursorTransformation from '../../transform/CursorTransformation';
import TranslateCursorHead from '../../transform/cursortransformationsteps/TranslateCursorHead';

export default function moveHeadBackward(): CursorCommand {
  return (taleWeaver: TaleWeaver): CursorTransformation => {
    const transformation = new CursorTransformation();
    const editorCursor = taleWeaver.getEditorCursor();
    if (!editorCursor) {
      return transformation;
    }
    if (editorCursor.getHead() < 1) {
      return transformation;
    }
    transformation.addStep(new TranslateCursorHead(-1));
    return transformation;
  };
}
