import Editor from '../../Editor';
import Transformation from '../../transform/Transformation';
import Command from '../Command';

export default function moveHeadToLeftOfDoc(): Command {
    return (editor: Editor): Transformation => {
        const cursorService = editor.getCursorService();
        const transformation = new Transformation();
        if (!cursorService.hasCursor()) {
            return transformation;
        }
        transformation.setCursorHead(0);
        return transformation;
    };
}
