import {
  Editor,
  Command,
  StateTransformation,
  CursorTransformation,
  stateOperations,
  cursorOperations,
} from '@taleweaver/core';
import EditExtension from '../EditExtension';

export default function deleteForward(editExtension: EditExtension): Command {
  return (editor: Editor): [StateTransformation, CursorTransformation] => {
    const stateTransformation = new StateTransformation();
    const cursorTransformation = new CursorTransformation();
    const anchor = editor.getCursor().getAnchor();
    const head = editor.getCursor().getHead();
    if (anchor < head) {
      stateTransformation.addOperation(new stateOperations.Delete(
        editor.convertSelectableOffsetToModelOffset(anchor),
        editor.convertSelectableOffsetToModelOffset(head),
      ));
      cursorTransformation.addOperation(new cursorOperations.MoveTo(anchor));
    } else if (anchor > head) {
      stateTransformation.addOperation(new stateOperations.Delete(
        editor.convertSelectableOffsetToModelOffset(head),
        editor.convertSelectableOffsetToModelOffset(anchor),
      ));
      cursorTransformation.addOperation(new cursorOperations.MoveTo(head));
    } else if (head < editor.getRenderEngine().getDocRenderNode().getSelectableSize() - 1) {
      stateTransformation.addOperation(new stateOperations.Delete(
        editor.convertSelectableOffsetToModelOffset(head),
        editor.convertSelectableOffsetToModelOffset(head + 1),
      ));
      cursorTransformation.addOperation(new cursorOperations.MoveTo(head));
    }
    return [stateTransformation, cursorTransformation];
  };
}
