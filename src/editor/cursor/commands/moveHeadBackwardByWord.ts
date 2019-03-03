import TaleWeaver from '../../TaleWeaver';
import Command from './Command';
import Transformation from '../Transformation';
import TranslateHead from '../operations/TranslateHead';

export default function moveHeadBackwardByWord(): Command {
  return (taleWeaver: TaleWeaver): Transformation => {
    const transformation = new Transformation();
    const editorCursor = taleWeaver.getEditorCursor();
    if (!editorCursor) {
      return transformation;
    }
    const head = editorCursor.getHead();
    const docView = taleWeaver.getDocView();
    const viewAwarePosition = docView.resolveModelPosition(head);
    if (viewAwarePosition.wordViewPosition > 0) {
      transformation.addOperation(new TranslateHead(0 - viewAwarePosition.wordViewPosition));
    } else {
      const previousWordView = viewAwarePosition.wordView.getPreviousWordView();
      if (previousWordView) {
        transformation.addOperation(new TranslateHead(0 - previousWordView.getSize()));
      }
    }
    return transformation;
  };
}
