import Editor from '../../Editor';
import Transformation from '../../transform/Transformation';
import Command from '../Command';

export default function moveHeadToRightOfDoc(): Command {
    return (editor: Editor): Transformation => {
        const cursorService = editor.getCursorService();
        const layoutService = editor.getLayoutService();
        const transformation = new Transformation();
        if (!cursorService.hasCursor()) {
            return transformation;
        }
        const docLayoutNode = layoutService.getDoc();
        transformation.setCursorHead(docLayoutNode.getSize() - 1);
        return transformation;
    };
}
