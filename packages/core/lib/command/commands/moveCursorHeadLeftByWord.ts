import Editor from '../../Editor';
import AtomicRenderNode from '../../render/AtomicRenderNode';
import Transformation from '../../transform/Transformation';
import Command from '../Command';

export default function moveHeadLeftByWord(): Command {
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
        if (atomicPosition.getOffset() > 0) {
            transformation.setCursorHead(head - atomicPosition.getOffset());
        } else {
            const previousAtomicNode = atomicNode.getPreviousSiblingAllowCrossParent();
            if (previousAtomicNode) {
                transformation.setCursorHead(head - previousAtomicNode.getSize());
            }
        }
        return transformation;
    };
}
