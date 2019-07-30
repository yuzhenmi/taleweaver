import Editor from '../../Editor';
import Transformation from '../../transform/Transformation';
import Command from '../Command';

export default function selectAll(): Command {
    return (editor: Editor): Transformation => {
        const transformation = new Transformation();
        const cursor = editor.getCursor();
        if (!cursor) {
            return transformation;
        }
        const docBox = editor.getLayoutManager().getDocBox();
        transformation.setCursor(0);
        transformation.setCursorHead(docBox.getSelectableSize() - 1);
        return transformation;
    };
}
