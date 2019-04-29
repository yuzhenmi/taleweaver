import Editor from '../../Editor';
import Command from '../Command';
import StateTransformation from '../../state/Transformation';
import CursorTransformation from '../../cursor/Transformation';
import * as cursorOperations from '../../cursor/operations';
import * as stateOperations from '../../state/operations';
import Token from '../../state/Token';
import OpenTagToken from '../../state/OpenTagToken';
import CloseTagToken from '../../state/CloseTagToken';
import generateID from '../../helpers/generateID';

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
        editor.convertSelectableOffsetToModelOffset(anchor),
        editor.convertSelectableOffsetToModelOffset(head),
      ));
    } else if (anchor > head) {
      stateTransformation.addOperation(new stateOperations.Delete(
        editor.convertSelectableOffsetToModelOffset(head),
        editor.convertSelectableOffsetToModelOffset(anchor),
      ));
      collapsedAt = head;
    }
    // Find preceding inline and block open tags
    const stateCollapsedAt = editor.convertSelectableOffsetToModelOffset(collapsedAt);
    const tokens = editor.getState().getTokens();
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
      editor.convertSelectableOffsetToModelOffset(collapsedAt),
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
