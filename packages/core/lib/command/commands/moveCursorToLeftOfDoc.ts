import Editor from '../../Editor';
import Transformation from '../../transform/Transformation';
import Command from '../Command';

export default function moveToLeftOfDoc(): Command {
    return (editor: Editor): Transformation => {
        const transformation = new Transformation();
        const cursorService = editor.getCursorService();
        if (!cursorService.hasCursor()) {
            return transformation;
        }
        transformation.setCursor(0);
        return transformation;
    };
}
