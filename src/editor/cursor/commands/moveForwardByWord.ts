import TaleWeaver from '../../TaleWeaver';
import Command from './Command';
import Transformation from '../Transformation';
import Translate from '../operations/Translate';

export default function moveForwardByWord(): Command {
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
      transformation.addOperation(new Translate(viewAwarePosition.wordView.getSize() - viewAwarePosition.wordViewPosition));
    } else {
      const nextWordView = viewAwarePosition.wordView.getNextWordView();
      if (nextWordView) {
        transformation.addOperation(new Translate(nextWordView.getSize()));
      }
    }
    return transformation;
  };
}
