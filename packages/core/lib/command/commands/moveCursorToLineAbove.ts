import Editor from '../../Editor';
import LineFlowBox from '../../layout/LineLayoutNode';
import Transformation from '../../transform/Transformation';
import Command from '../Command';

export default function moveToLineAbove(): Command {
    return (editor: Editor): Transformation => {
        const cursorService = editor.getCursorService();
        const layoutService = editor.getLayoutService();
        const transformation = new Transformation();
        if (!cursorService.hasCursor()) {
            return transformation;
        }
        const offset = Math.min(cursorService.getAnchor(), cursorService.getHead());
        const position = layoutService.resolvePosition(offset);
        const linePosition = position.getLeaf().getParent()!.getParent()!;
        const lineNode = linePosition.getNode();
        if (!(lineNode instanceof LineFlowBox)) {
            throw new Error(`Expecting position to be referencing an line node.`);
        }
        const previousLineNode = lineNode.getPreviousSiblingAllowCrossParent();
        if (!previousLineNode) {
            transformation.setCursor(offset - linePosition.getOffset());
        } else {
            let leftLock = cursorService.getLeftLock();
            if (leftLock === null) {
                leftLock = lineNode.resolveRects(
                    linePosition.getOffset(),
                    linePosition.getOffset(),
                )[0].left;
            }
            transformation.setCursorLockLeft(leftLock);
            const targetLineSelectableOffset = previousLineNode.convertCoordinatesToOffset(leftLock);
            transformation.setCursor(offset - linePosition.getOffset() - previousLineNode.getSize() + targetLineSelectableOffset);
        }
        return transformation;
    };
}
