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
        const linePosiiton = position.getLeaf().getParent()!.getParent()!;
        const lineNode = linePosiiton.getNode();
        if (!(lineNode instanceof LineLayoutNode)) {
            throw new Error(`Expecting position to be referencing an line node.`);
        }
        const previousLineNode = lineNode.getPreviousSiblingAllowCrossParent();
        if (!previousLineNode) {
            transformation.setCursorHead(offset - linePosiiton.getOffset());
        } else {
            let leftLock = cursorService.getLeftLock();
            if (leftLock === null) {
                leftLock = lineNode.resolveRects(
                    linePosiiton.getOffset(),
                    linePosiiton.getOffset(),
                )[0].left;
            }
            transformation.setCursorLockLeft(leftLock);
            const targetLineSelectableOffset = previousLineNode.convertCoordinatesToOffset(leftLock);
            transformation.setCursorHead(offset - linePosiiton.getOffset() - previousLineNode.getSize() + targetLineSelectableOffset);
        }
        return transformation;
    };
}
