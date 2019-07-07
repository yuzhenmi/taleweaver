import Editor from '../../Editor';
import Transformation from '../../transform/Transformation';
import Command from '../Command';

export default function moveToLeftOfLine(): Command {
  return (editor: Editor): Transformation => {
    const transformation = new Transformation();
    const cursor = editor.getCursor();
    if (!cursor) {
      return transformation;
    }
    const head = cursor.getHead();
    const docBox = editor.getLayoutManager().getDocBox();
    const position = docBox.resolvePosition(head);
    const lineBoxLevelPosition = position.getLineFlowBoxLevel();
    if (lineBoxLevelPosition.getOffset() > 0) {
      transformation.setCursor(head - lineBoxLevelPosition.getOffset());
    } else {
      transformation.setCursor(head);
    }
    return transformation;
  };
}
