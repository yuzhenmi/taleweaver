import TaleWeaver from '../TaleWeaver';
import CursorCommand from './CursorCommand';
import CursorTransformation from '../cursortransformer/CursorTransformation';
import TranslateCursor from '../cursortransformer/steps/TranslateCursor';

export default function moveToDocumentStart(): CursorCommand {
  return (taleWeaver: TaleWeaver): CursorTransformation => {
    const transformation = new CursorTransformation();
    const editorCursor = taleWeaver.getEditorCursor();
    if (!editorCursor) {
      return transformation;
    }
    const head = editorCursor.getHead();
    transformation.addStep(new TranslateCursor(0 - head));
    return transformation;
  };
}
