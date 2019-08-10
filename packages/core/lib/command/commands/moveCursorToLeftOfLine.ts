import Editor from '../../Editor';
import Transformation from '../../transform/Transformation';
import Command from '../Command';

export default function moveToLeftOfLine(): Command {
    return (editor: Editor): Transformation => {
        const cursorService = editor.getCursorService();
        const layoutService = editor.getLayoutService();
        const transformation = new Transformation();
        if (!cursorService.hasCursor()) {
            return transformation;
        }
        const head = cursorService.getHead();
        const position = layoutService.resolvePosition(head);
        const lineBoxLevelPosition = position.getLeaf().getParent()!.getParent()!;
        if (lineBoxLevelPosition.getOffset() > 0) {
            transformation.setCursor(head - lineBoxLevelPosition.getOffset());
        } else {
            transformation.setCursor(head);
        }
        return transformation;
    };
}
