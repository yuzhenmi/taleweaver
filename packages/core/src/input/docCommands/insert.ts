import Editor from '../../Editor';
import Command from '../Command';
import StateTransformation from '../../state/Transformation';
import CursorTransformation from '../../cursor/Transformation';
import * as cursorOperations from '../../cursor/operations';
import * as stateOperations from '../../state/operations';
import Token from '../../state/Token';

export default function insert(tokens: Token[]): Command {
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
    stateTransformation.addOperation(new stateOperations.Insert(
      editor.convertSelectableOffsetToModelOffset(collapsedAt),
      tokens,
    ));
    cursorTransformation.addOperation(new cursorOperations.MoveTo(collapsedAt + tokens.filter(t => typeof(t) === 'string').length));
    return [stateTransformation, cursorTransformation];
  };
}
