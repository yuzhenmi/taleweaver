import Editor from '../../Editor';
import LineLayoutNode from '../../layout/LineLayoutNode';
import Transformation from '../../transform/Transformation';
import Command from '../Command';

export default function moveHeadToLineAbove(): Command {
    return (editor: Editor): Transformation => {
        const cursorService = editor.getCursorService();
        const layoutService = editor.getLayoutService();
        const transformation = new Transformation();
        if (!cursorService.hasCursor()) {
            return transformation;
        }
        const offset = cursorService.getHead();
        const position = layoutService.resolvePosition(offset);
        const lineLayoutPosition = position.getLeaf().getParent()!.getParent()!;
        const lineLayoutNode = lineLayoutPosition.getNode();
        if (!(lineLayoutNode instanceof LineLayoutNode)) {
            throw new Error(`Expecting position to be referencing an line node.`);
        }
        const previousLineLayoutNode = lineLayoutNode.getPreviousSibling();
        if (!previousLineLayoutNode) {
            transformation.setCursorHead(offset - lineLayoutPosition.getOffset());
        } else {
            let leftLock = cursorService.getLeftLock();
            if (leftLock === null) {
                leftLock = lineLayoutNode.resolveRects(
                    lineLayoutPosition.getOffset(),
                    lineLayoutPosition.getOffset(),
                )[0].left;
            }
            transformation.setCursorLockLeft(leftLock);
            const targetLineSelectableOffset = previousLineLayoutNode.convertCoordinatesToOffset(leftLock);
            transformation.setCursorHead(offset - lineLayoutPosition.getOffset() - previousLineLayoutNode.getSize() + targetLineSelectableOffset);
        }
        return transformation;
    };
}
