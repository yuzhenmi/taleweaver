import Editor from '../../Editor';
import CloseTagToken from '../../token/CloseTagToken';
import OpenTagToken from '../../token/OpenTagToken';
import Token from '../../token/Token';
import { Delete, Insert } from '../../transform/operations';
import Transformation from '../../transform/Transformation';
import generateID from '../../utils/generateID';
import Command from '../Command';

export default function split(): Command {
    return (editor: Editor): Transformation => {
        const transformation = new Transformation();
        const cursor = editor.getCursor();
        if (!cursor) {
            return transformation;
        }
        const anchor = cursor.getAnchor();
        const head = cursor.getHead();
        let collapsedAt = anchor;
        if (anchor < head) {
            transformation.addOperation(new Delete(
                editor.getRenderManager().convertSelectableOffsetToModelOffset(anchor),
                editor.getRenderManager().convertSelectableOffsetToModelOffset(head),
            ));
        } else if (anchor > head) {
            transformation.addOperation(new Delete(
                editor.getRenderManager().convertSelectableOffsetToModelOffset(head),
                editor.getRenderManager().convertSelectableOffsetToModelOffset(anchor),
            ));
            collapsedAt = head;
        }
        // Find preceding inline and block open tags
        const stateCollapsedAt = editor.getRenderManager().convertSelectableOffsetToModelOffset(collapsedAt);
        const tokens = editor.getTokenManager().getTokenState().getTokens();
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
            editor.getRenderManager().convertSelectableOffsetToModelOffset(collapsedAt),
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
