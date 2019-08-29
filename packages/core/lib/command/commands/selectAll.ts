import Editor from '../../Editor';
import Transformation from '../../transform/Transformation';
import Command from '../Command';

export default function selectAll(): Command {
    return (editor: Editor): Transformation => {
        const cursorService = editor.getCursorService();
        const renderService = editor.getRenderService();
        const transformation = new Transformation();
        if (!cursorService.hasCursor()) {
            return transformation;
        }
        const docSize = renderService.getDocSize();
        transformation.setCursor(0);
        transformation.setCursorHead(docSize - 1);
        return transformation;
    };
}
