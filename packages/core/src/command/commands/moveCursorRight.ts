import Editor from '../../Editor';
import Transformation from '../../transform/Transformation';
import Command from '../Command';

export default function moveRight(): Command {
    return (editor: Editor): Transformation => {
        const transformation = new Transformation();
        const cursor = editor.getCursor();
        if (!cursor) {
            return transformation;
        }
        const anchor = cursor.getAnchor();
        const head = cursor.getHead();
        const docBox = editor.getLayoutManager().getDocBox();
        if (anchor === head) {
            if (head >= docBox.getSelectableSize() - 1) {
                return transformation;
            }
            transformation.setCursor(head + 1);
        } else {
            if (anchor < head) {
                transformation.setCursor(head);
            } else if (anchor > head) {
                transformation.setCursor(anchor);
            }
        }
        return transformation;
    };
}
