import TaleWeaver from '../../TaleWeaver';
import Command from './Command';
import Transformation from '../Transformation';
import TranslateHead from '../operations/TranslateHead';

export default function moveHeadToDocumentEnd(): Command {
  return (taleWeaver: TaleWeaver): Transformation => {
    const transformation = new Transformation();
    const editorCursor = taleWeaver.getEditorCursor();
    if (!editorCursor) {
      return transformation;
    }
    const head = editorCursor.getHead();
    const documentSize = taleWeaver.getDoc().getSize();
    transformation.addOperation(new TranslateHead(documentSize - 1 - head));
    return transformation;
  };
}
