import Editor from '../../Editor';
import Transformation from '../../transform/Transformation';
import LineFlowBox from '../../layout/LineFlowBox';
import Command from '../Command';

export default function moveHeadToRightOfLine(): Command {
  return (editor: Editor): Transformation => {
    const transformation = new Transformation();
    const cursor = editor.getCursor();
    if (!cursor) {
      return transformation;
    }
    const head = cursor.getHead();
    const docBox = editor.getLayoutManager().getDocBox();
    const position = docBox.resolvePosition(head);
    const lineFlowBoxLevelPosition = position.getLineFlowBoxLevel();
    const lineFlowBox = lineFlowBoxLevelPosition.getLayoutNode();
    if (!(lineFlowBox instanceof LineFlowBox)) {
      throw new Error(`Expecting position to be referencing an line box.`);
    }
    if (lineFlowBoxLevelPosition.getOffset() < lineFlowBox.getSize() - 1) {
      transformation.setCursorHead(head - lineFlowBoxLevelPosition.getOffset() + lineFlowBox.getSize() - 1);
    } else {
      transformation.setCursorHead(head);
    }
    return transformation;
  };
}
