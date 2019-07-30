import Editor from '../../Editor';
import { Delete } from '../../transform/operations';
import Transformation from '../../transform/Transformation';
import Command from '../Command';

export default function deleteForward(): Command {
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
            transformation.addOperation(new Delete(
                editor.getRenderManager().convertSelectableOffsetToModelOffset(head),
                editor.getRenderManager().convertSelectableOffsetToModelOffset(head + 1),
            ));
        } else {
            if (anchor < head) {
                transformation.addOperation(new Delete(
                    editor.getRenderManager().convertSelectableOffsetToModelOffset(anchor),
                    editor.getRenderManager().convertSelectableOffsetToModelOffset(head),
                ));
                transformation.setCursor(anchor);
            } else if (anchor > head) {
                transformation.addOperation(new Delete(
                    editor.getRenderManager().convertSelectableOffsetToModelOffset(head),
                    editor.getRenderManager().convertSelectableOffsetToModelOffset(anchor),
                ));
                transformation.setCursor(head);
            }
        }
        return transformation;
    };
}
