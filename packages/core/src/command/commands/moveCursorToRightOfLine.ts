import Editor from '../../Editor';
import LineFlowBox from '../../layout/LineLayoutNode';
import Transformation from '../../transform/Transformation';
import Command from '../Command';

export default function moveToRightOfLine(): Command {
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
        if (lineFlowBoxLevelPosition.getSelectableOffset() < lineFlowBox.getSelectableSize() - 1) {
            transformation.setCursor(head - lineFlowBoxLevelPosition.getSelectableOffset() + lineFlowBox.getSelectableSize() - 1);
        } else {
            transformation.setCursor(head);
        }
        return transformation;
    };
}
