import Editor from '../../Editor';
import AtomicRenderNode from '../../render/AtomicRenderNode';
import Transformation from '../../transform/Transformation';
import Command from '../Command';

export default function moveLeftByWord(): Command {
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
        if (atomicPosition.getOffset() > 0) {
            transformation.setCursor(head - atomicPosition.getOffset());
        } else {
            const atomicNode = atomicPosition.getNode();
            if (!(atomicNode instanceof AtomicRenderNode)) {
                throw new Error(`Expecting position to be referencing an atomic node.`);
            }
            const previousAtomicNode = atomicNode.getPreviousSiblingAllowCrossParent();
            if (previousAtomicNode) {
                transformation.setCursor(head - previousAtomicNode.getSize());
            } else {
                transformation.setCursor(head);
            }
        }
        return transformation;
    };
}
