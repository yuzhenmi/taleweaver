import Editor from '../../Editor';
import Transformation from '../../transform/Transformation';
import Command from '../Command';

export default function moveToRightOfDoc(): Command {
    return (editor: Editor): Transformation => {
        const cursorService = editor.getCursorService();
        const layoutService = editor.getLayoutService();
        const transformation = new Transformation();
        if (!cursorService.hasCursor()) {
            return transformation;
        }
        const docLayoutNode = layoutService.getDoc();
        transformation.setCursor(docLayoutNode.getSize() - 1);
        return transformation;
    };
}
