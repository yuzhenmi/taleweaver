import Editor from '../../Editor';
import CloseTagToken from '../../state/CloseTagToken';
import OpenTagToken from '../../state/OpenTagToken';
import Token from '../../state/Token';
import Delete from '../../transform/operations/Delete';
import Insert from '../../transform/operations/Insert';
import Transformation from '../../transform/Transformation';
import generateID from '../../utils/generateID';
import Command from '../Command';

export default function split(): Command {
    return (editor: Editor): Transformation => {
        const stateService = editor.getStateService();
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
        // Find preceding inline and block open tags
        const stateCollapsedAt = renderService.convertOffsetToModelOffset(collapsedAt);
        const tokens = stateService.getTokens();
        let inlineOpenTagToken: OpenTagToken | null = null;
        let blockOpenTagToken: OpenTagToken | null = null;
        let token: Token;
        for (let n = stateCollapsedAt; n > 0; n--) {
            token = tokens[n];
            if (!(token instanceof OpenTagToken)) {
                continue;
            }
            if (inlineOpenTagToken === null) {
                inlineOpenTagToken = token;
            } else if (blockOpenTagToken === null) {
                blockOpenTagToken = token;
            }
        }
        if (inlineOpenTagToken === null || blockOpenTagToken === null) {
            throw new Error('State is corrupted, cannot perform split.');
        }
        transformation.addOperation(new Insert(
            renderService.convertOffsetToModelOffset(collapsedAt),
            [
                new CloseTagToken(),
                new CloseTagToken(),
                new OpenTagToken(
                    blockOpenTagToken.getType(),
                    generateID(),
                    blockOpenTagToken.getAttributes(),
                ),
                new OpenTagToken(
                    inlineOpenTagToken.getType(),
                    generateID(),
                    inlineOpenTagToken.getAttributes(),
                ),
            ],
        ));
        transformation.setCursor(collapsedAt + 1);
        return transformation;
    };
}
