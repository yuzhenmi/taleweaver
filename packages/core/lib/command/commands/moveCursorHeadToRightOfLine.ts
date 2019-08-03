import Editor from '../../Editor';
import LineFlowBox from '../../layout/LineLayoutNode';
import Transformation from '../../transform/Transformation';
import Command from '../Command';

export default function moveHeadToRightOfLine(): Command {
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
            transformation.setCursorHead(head - lineLayoutPosition.getOffset() + lineLayoutNode.getSize() - 1);
        } else {
            transformation.setCursorHead(head);
        }
        return transformation;
    };
}
