import Editor from '../../Editor';
import Transformation from '../../transform/Transformation';
import Command from '../Command';

export default function moveHeadToLeftOfLine(): Command {
    return (editor: Editor): Transformation => {
        const cursorService = editor.getCursorService();
        const layoutService = editor.getLayoutService();
        const transformation = new Transformation();
        if (!cursorService.hasCursor()) {
            return transformation;
        }
        const head = cursorService.getHead();
        const position = layoutService.resolvePosition(head);
        const lineLayoutPosition = position.getLeaf().getParent()!.getParent()!;
        if (lineLayoutPosition.getOffset() > 0) {
            transformation.setCursorHead(head - lineLayoutPosition.getOffset());
        } else {
            transformation.setCursorHead(head);
        }
        return transformation;
    };
}
