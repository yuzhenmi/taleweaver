import {
  Editor,
  Command,
  StateTransformation,
  CursorTransformation,
  stateOperations,
  cursorOperations,
} from '@taleweaver/core';
import EditExtension from '../EditExtension';

export default function insertChar(editExtension: EditExtension, char: string): Command {
  return (editor: Editor): [StateTransformation, CursorTransformation] => {
    const cursorHead = editor.getCursor().getHead();
    const insertAt = editor.convertSelectableOffsetToModelOffset(cursorHead);
    const stateTransformation = new StateTransformation();
    const cursorTransformation = new CursorTransformation();
    stateTransformation.addOperation(new stateOperations.Insert(insertAt, [char]));
    cursorTransformation.addOperation(new cursorOperations.MoveTo(cursorHead + 1));
    return [stateTransformation, cursorTransformation];
  };
}
