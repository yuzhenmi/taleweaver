import Editor from '../../Editor';
import AtomicRenderNode from '../../render/AtomicRenderNode';
import Transformation from '../../transform/Transformation';
import Command from '../Command';

export default function moveHeadRightByWord(): Command {
    return (editor: Editor): Transformation => {
        const cursorService = editor.getCursorService();
        const renderService = editor.getRenderService();
        const transformation = new Transformation();
        if (!cursorService.hasCursor()) {
            return transformation;
        }
        const head = cursorService.getHead();
        const position = renderService.resolvePosition(head);
        const atomicPosition = position.getLeaf();
        const atomicNode = atomicPosition.getNode();
        if (!(atomicNode instanceof AtomicRenderNode)) {
            throw new Error(`Expecting position to be referencing an atomic node.`);
        }
        if (atomicPosition.getOffset() < atomicNode.getSize() - 1) {
            transformation.setCursorHead(head - atomicPosition.getOffset() + atomicNode.getSize() - 1);
        } else {
            const nextAtomicNode = atomicNode.getNextSiblingAllowCrossParent();
            if (nextAtomicNode) {
                let newCursorPosition = head - atomicPosition.getOffset() + atomicNode.getSize() + nextAtomicNode.getSize();
                if (nextAtomicNode.getBreakable()) {
                    newCursorPosition--;
                }
                transformation.setCursorHead(newCursorPosition);
            }
        }
        return transformation;
    };
}
