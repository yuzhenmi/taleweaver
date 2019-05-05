import Editor from '../../Editor';
import Command from '../Command';
import StateTransformation from '../../token/Transformation';
import CursorTransformation from '../../cursor/Transformation';
import * as cursorOperations from '../../cursor/operations';

export default function selectAll(): Command {
  return (editor: Editor): [StateTransformation, CursorTransformation] => {
    const stateTransformation = new StateTransformation();
    const cursorTransformation = new CursorTransformation();
    const cursor = editor.getCursor();
    if (!cursor) {
      return [stateTransformation, cursorTransformation];
    }
    const docBox = editor.getLayoutManager().getDocBox();
    cursorTransformation.addOperation(new cursorOperations.MoveTo(0));
    cursorTransformation.addOperation(new cursorOperations.MoveHeadTo(docBox.getSelectableSize() - 1));
    return [stateTransformation, cursorTransformation];
  };
}
