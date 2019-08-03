import Editor from '../../Editor';
import AtomicLayoutNode from '../../layout/AtomicLayoutNode';
import Transformation from '../../transform/Transformation';
import Command from '../Command';

export default function moveHeadRightByWord(): Command {
    return (editor: Editor): Transformation => {
        const cursorService = editor.getCursorService();
        const layoutService = editor.getLayoutService();
        const transformation = new Transformation();
        if (!cursorService.hasCursor()) {
            return transformation;
        }
        const head = cursorService.getHead();
        const position = layoutService.resolvePosition(head);
        const atomicLayoutPosition = position.getLeaf();
        const atomicLayoutNode = atomicLayoutPosition.getNode();
        if (!(atomicLayoutNode instanceof AtomicLayoutNode)) {
            throw new Error(`Expecting position to be referencing an atomic layout node.`);
        }
        if (atomicLayoutPosition.getOffset() < atomicLayoutNode.getSize() - 1) {
            transformation.setCursorHead(head - atomicLayoutPosition.getOffset() + atomicLayoutNode.getSize() - 1);
        } else {
            const nextAtomicLayoutNode = atomicLayoutNode.getNextSibling();
            if (nextAtomicLayoutNode) {
                transformation.setCursorHead(head - atomicLayoutPosition.getOffset() + atomicLayoutNode.getSize() - 1 + nextAtomicLayoutNode.getSize());
            }
        }
        return transformation;
    };
}
