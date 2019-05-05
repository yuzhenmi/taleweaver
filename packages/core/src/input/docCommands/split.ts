import Editor from '../../Editor';
import Command from '../Command';
import StateTransformation from '../../token/Transformation';
import CursorTransformation from '../../cursor/Transformation';
import * as cursorOperations from '../../cursor/operations';
import * as stateOperations from '../../token/operations';
import Token from '../../token/Token';
import OpenTagToken from '../../token/OpenTagToken';
import CloseTagToken from '../../token/CloseTagToken';
import generateID from '../../utils/generateID';

export default function split(): Command {
  return (editor: Editor): [StateTransformation, CursorTransformation] => {
    const stateTransformation = new StateTransformation();
    const cursorTransformation = new CursorTransformation();
    const cursor = editor.getCursor();
    if (!cursor) {
      return [stateTransformation, cursorTransformation];
    }
    const anchor = cursor.getAnchor();
    const head = cursor.getHead();
    let collapsedAt = anchor;
    if (anchor < head) {
      stateTransformation.addOperation(new stateOperations.Delete(
        editor.getRenderManager().convertSelectableOffsetToModelOffset(anchor),
        editor.getRenderManager().convertSelectableOffsetToModelOffset(head),
      ));
    } else if (anchor > head) {
      stateTransformation.addOperation(new stateOperations.Delete(
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
    stateTransformation.addOperation(new stateOperations.Insert(
      editor.getRenderManager().convertSelectableOffsetToModelOffset(collapsedAt),
      [
        '\n',
        new CloseTagToken(), // Close inline
        new CloseTagToken(), // Close block
        new OpenTagToken(blockOpenTagToken.getType(), generateID(), blockOpenTagToken.getAttributes()), // Open block
        new OpenTagToken(inlineOpenTagToken.getType(), generateID(), inlineOpenTagToken.getAttributes()), // Open inline
      ],
    ));
    cursorTransformation.addOperation(new cursorOperations.MoveTo(collapsedAt + 1));
    return [stateTransformation, cursorTransformation];
  };
}
