import Editor from '../../Editor';
import AtomicLayoutNode from '../../layout/AtomicLayoutNode';
import Transformation from '../../transform/Transformation';
import Command from '../Command';

export default function moveLeftByWord(): Command {
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
        if (atomicLayoutPosition.getOffset() > 0) {
            transformation.setCursor(head - atomicLayoutPosition.getOffset());
        } else {
            const atomicLayoutNode = atomicLayoutPosition.getNode();
            if (!(atomicLayoutNode instanceof AtomicLayoutNode)) {
                throw new Error(`Expecting position to be referencing an atomic layout node.`);
            }
            const previousAtomicLayoutNode = atomicLayoutNode.getPreviousSibling();
            if (previousAtomicLayoutNode) {
                transformation.setCursor(head - previousAtomicLayoutNode.getSize());
            } else {
                transformation.setCursor(head);
            }
        }
        return transformation;
    };
}
