import TaleWeaver from '../../TaleWeaver';
import Command from './Command';
import Transformation from '../Transformation';
import TranslateHead from '../operations/TranslateHead';

export default function moveHeadBackward(): Command {
  return (taleWeaver: TaleWeaver): Transformation => {
    const transformation = new Transformation();
    const editorCursor = taleWeaver.getEditorCursor();
    if (!editorCursor) {
      return transformation;
    }
    if (editorCursor.getHead() < 1) {
      return transformation;
    }
    transformation.addOperation(new TranslateHead(-1));
    return transformation;
  };
}
