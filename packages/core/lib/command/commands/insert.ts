import Editor from '../../Editor';
import BlockModelNode from '../../model/BlockModelNode';
import OpenTagToken from '../../state/OpenTagToken';
import Token from '../../state/Token';
import Delete from '../../transform/operations/Delete';
import Insert from '../../transform/operations/Insert';
import Transformation from '../../transform/Transformation';
import Command from '../Command';

export default function insert(tokens: Token[]): Command {
    return (editor: Editor): Transformation => {
        const cursorService = editor.getCursorService();
        const renderService = editor.getRenderService();
        const transformation = new Transformation();
        if (!cursorService.hasCursor()) {
            return transformation;
        }
        const anchor = cursorService.getAnchor();
        const head = cursorService.getHead();
        let collapsedAt = anchor;
        if (anchor < head) {
            transformation.addOperation(new Delete(
                renderService.convertOffsetToModelOffset(anchor),
                renderService.convertOffsetToModelOffset(head),
            ));
        } else if (anchor > head) {
            transformation.addOperation(new Delete(
                renderService.convertOffsetToModelOffset(head),
                renderService.convertOffsetToModelOffset(anchor),
            ));
            collapsedAt = head;
        }
        transformation.addOperation(new Insert(
            renderService.convertOffsetToModelOffset(collapsedAt),
            tokens,
        ));
        const nodeConfig = editor.getConfig().getNodeConfig();
        const insertedSelectableSize = tokens.filter(token => {
            if (typeof (token) === 'string') {
                return true;
            }
            if (token instanceof OpenTagToken) {
                const ModelNodeClass = nodeConfig.getModelNodeClass(token.getType());
                if (ModelNodeClass.prototype instanceof BlockModelNode) {
                    return true;
                }
            }
            return false;
        }).length;
        transformation.setCursor(collapsedAt + insertedSelectableSize);
        return transformation;
    };
}
