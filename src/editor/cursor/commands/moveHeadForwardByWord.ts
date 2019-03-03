import TaleWeaver from '../../TaleWeaver';
import Command from './Command';
import Transformation from '../Transformation';
import TranslateHead from '../operations/TranslateHead';

export default function moveHeadForwardByWord(): Command {
  return (taleWeaver: TaleWeaver): Transformation => {
    const transformation = new Transformation();
    const editorCursor = taleWeaver.getEditorCursor();
    if (!editorCursor) {
      return transformation;
    }
    const head = editorCursor.getHead();
    const docView = taleWeaver.getDocView();
    const viewAwarePosition = docView.resolveModelPosition(head);
    if (viewAwarePosition.wordViewPosition < viewAwarePosition.wordView.getSize()) {
      transformation.addOperation(new TranslateHead(viewAwarePosition.wordView.getSize() - viewAwarePosition.wordViewPosition));
    } else {
      const nextWordView = viewAwarePosition.wordView.getNextWordView();
      if (nextWordView) {
        transformation.addOperation(new TranslateHead(nextWordView.getSize()));
      }
    }
    return transformation;
  };
}
