import Editor from '../../Editor';
import LineFlowBox from '../../layout/LineLayoutNode';
import Transformation from '../../transform/Transformation';
import Command from '../Command';

export default function moveToRightOfLine(): Command {
    return (editor: Editor): Transformation => {
        const cursorService = editor.getCursorService();
        const layoutService = editor.getLayoutService();
        const transformation = new Transformation();
        if (!cursorService.hasCursor()) {
            return transformation;
        }
        const head = cursorService.getHead();
        const position = layoutService.resolvePosition(head);
        const lineLayoutPosition = position.getLeaf().getParent()!.getParent()!;
        const lineLayoutNode = lineLayoutPosition.getNode();
        if (!(lineLayoutNode instanceof LineFlowBox)) {
            throw new Error(`Expecting position to be referencing an line layout node.`);
        }
        if (lineLayoutPosition.getOffset() < lineLayoutNode.getSize() - 1) {
            transformation.setCursor(head - lineLayoutPosition.getOffset() + lineLayoutNode.getSize() - 1);
        } else {
            transformation.setCursor(head);
        }
        return transformation;
    };
}
