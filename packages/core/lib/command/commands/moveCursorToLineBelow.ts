import Editor from '../../Editor';
import LineFlowBox from '../../layout/LineLayoutNode';
import Transformation from '../../transform/Transformation';
import Command from '../Command';

export default function moveToLineBelow(): Command {
    return (editor: Editor): Transformation => {
        const cursorService = editor.getCursorService();
        const layoutService = editor.getLayoutService();
        const transformation = new Transformation();
        if (!cursorService.hasCursor()) {
            return transformation;
        }
        const offset = Math.max(cursorService.getAnchor(), cursorService.getHead());
        const position = layoutService.resolvePosition(offset);
        const lineLayoutPosition = position.getLeaf().getParent()!.getParent()!;
        const lineLayoutNode = lineLayoutPosition.getNode();
        if (!(lineLayoutNode instanceof LineFlowBox)) {
            throw new Error(`Expecting position to be referencing an line layout node.`);
        }
        const nextLineFlowBox = lineLayoutNode.getNextSibling();
        if (!nextLineFlowBox) {
            transformation.setCursor(offset - lineLayoutPosition.getOffset() + lineLayoutNode.getSize() - 1);
        } else {
            let leftLock = cursorService.getLeftLock();
            if (leftLock === null) {
                leftLock = lineLayoutNode.resolveRects(
                    lineLayoutPosition.getOffset(),
                    lineLayoutPosition.getOffset(),
                )[0].left;
            }
            transformation.setCursorLockLeft(leftLock);
            const targetLineSelectableOffset = nextLineFlowBox.convertCoordinatesToOffset(leftLock);
            transformation.setCursor(offset - lineLayoutPosition.getOffset() + lineLayoutNode.getSize() + targetLineSelectableOffset);
        }
        return transformation;
    };
}
