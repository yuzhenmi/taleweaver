import Editor from '../../Editor';
import Transformation from '../../transform/Transformation';
import Command from '../Command';

export default function moveHeadLeft(): Command {
    return (editor: Editor): Transformation => {
        const cursorService = editor.getCursorService();
        const transformation = new Transformation();
        if (!cursorService.hasCursor()) {
            return transformation;
        }
        const head = cursorService.getHead();
        if (head < 1) {
            return transformation;
        }
        transformation.setCursorHead(head - 1);
        return transformation;
    };
}
