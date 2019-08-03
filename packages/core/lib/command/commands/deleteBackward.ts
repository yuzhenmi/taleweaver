import Editor from '../../Editor';
import Delete from '../../transform/operations/Delete';
import Transformation from '../../transform/Transformation';
import Command from '../Command';

export default function deleteBackward(): Command {
    return (editor: Editor): Transformation => {
        const cursorService = editor.getCursorService();
        const renderService = editor.getRenderService();
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
            transformation.addOperation(new Delete(
                renderService.convertOffsetToModelOffset(head - 1),
                renderService.convertOffsetToModelOffset(head),
            ));
            transformation.setCursor(head - 1);
        } else {
            if (anchor < head) {
                transformation.addOperation(new Delete(
                    renderService.convertOffsetToModelOffset(anchor),
                    renderService.convertOffsetToModelOffset(head),
                ));
                transformation.setCursor(anchor);
            } else if (anchor > head) {
                transformation.addOperation(new Delete(
                    renderService.convertOffsetToModelOffset(head),
                    renderService.convertOffsetToModelOffset(anchor),
                ));
                transformation.setCursor(head);
            }
        }
        return transformation;
    };
}
