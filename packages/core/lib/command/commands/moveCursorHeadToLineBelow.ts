import Editor from '../../Editor';
import LineLayoutNode from '../../layout/LineLayoutNode';
import Transformation from '../../transform/Transformation';
import Command from '../Command';

export default function moveHeadToLineBelow(): Command {
    return (editor: Editor): Transformation => {
        const cursorService = editor.getCursorService();
        const layoutService = editor.getLayoutService();
        const transformation = new Transformation();
        if (!cursorService.hasCursor()) {
            return transformation;
        }
        const offset = cursorService.getHead();
        const position = layoutService.resolvePosition(offset);
        const linePosition = position.getLeaf().getParent()!.getParent()!;
        const lineNode = linePosition.getNode();
        if (!(lineNode instanceof LineLayoutNode)) {
            throw new Error(`Expecting position to be referencing an line node.`);
        }
        const nextLineNode = lineNode.getNextSiblingAllowCrossParent();
        if (!nextLineNode) {
            transformation.setCursorHead(offset - linePosition.getOffset() + lineNode.getSize() - 1);
        } else {
            let leftLock = cursorService.getLeftLock();
            if (leftLock === null) {
                leftLock = lineNode.resolveRects(
                    linePosition.getOffset(),
                    linePosition.getOffset(),
                )[0].left;
            }
            transformation.setCursorLockLeft(leftLock);
            const targetLineSelectableOffset = nextLineNode.convertCoordinatesToOffset(leftLock);
            transformation.setCursorHead(offset - linePosition.getOffset() + lineNode.getSize() + targetLineSelectableOffset);
        }
        return transformation;
    };
}
