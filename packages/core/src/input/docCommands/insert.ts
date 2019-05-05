import Editor from '../../Editor';
import Command from '../Command';
import StateTransformation from '../../token/Transformation';
import CursorTransformation from '../../cursor/Transformation';
import * as cursorOperations from '../../cursor/operations';
import * as stateOperations from '../../token/operations';
import Token from '../../token/Token';

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
    stateTransformation.addOperation(new stateOperations.Insert(
      editor.getRenderManager().convertSelectableOffsetToModelOffset(collapsedAt),
      tokens,
    ));
    cursorTransformation.addOperation(new cursorOperations.MoveTo(collapsedAt + tokens.filter(t => typeof(t) === 'string').length));
    return [stateTransformation, cursorTransformation];
  };
}
