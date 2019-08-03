import Editor from '../../Editor';
import Transformation from '../../transform/Transformation';
import Command from '../Command';

export default function moveLeft(): Command {
    return (editor: Editor): Transformation => {
        const cursorService = editor.getCursorService();
        const transformation = new Transformation();
        if (!cursorService.hasCursor()) {
            return transformation;
        }
        const anchor = cursorService.getAnchor();
        const head = cursorService.getHead();
        if (anchor === head) {
            if (head < 1) {
                return transformation;
            }
            transformation.setCursor(head - 1);
        } else {
            if (anchor < head) {
                transformation.setCursor(anchor);
            } else if (anchor > head) {
                transformation.setCursor(head);
            }
        }
        return transformation;
    };
}
