import Editor from '../../Editor';
import Transformation from '../../transform/Transformation';
import Command from '../Command';

export default function moveRight(): Command {
    return (editor: Editor): Transformation => {
        const cursorService = editor.getCursorService();
        const layoutService = editor.getLayoutService();
        const transformation = new Transformation();
        if (!cursorService.hasCursor()) {
            return transformation;
        }
        const anchor = cursorService.getAnchor();
        const head = cursorService.getHead();
        const docLayoutNode = layoutService.getDoc();
        if (anchor === head) {
            if (head >= docLayoutNode.getSize() - 1) {
                return transformation;
            }
            transformation.setCursor(head + 1);
        } else {
            if (anchor < head) {
                transformation.setCursor(head);
            } else if (anchor > head) {
                transformation.setCursor(anchor);
            }
        }
        return transformation;
    };
}
