import Editor from '../../Editor';
import Transformation from '../../transform/Transformation';
import Command from '../Command';

export default function moveHeadLeft(): Command {
    return (editor: Editor): Transformation => {
        const transformation = new Transformation();
        const cursor = editor.getCursor();
        if (!cursor) {
            return transformation;
        }
        const head = cursor.getHead();
        if (head < 1) {
            return transformation;
        }
        transformation.setCursorHead(head - 1);
        return transformation;
    };
}
