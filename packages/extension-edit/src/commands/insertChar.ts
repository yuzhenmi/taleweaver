import {
  Editor,
  StateCommand,
  StateTransformation,
  stateOperations,
} from '@taleweaver/core';
import EditExtension from '../EditExtension';

export default function insertChar(editExtension: EditExtension, char: string): StateCommand {
  return (editor: Editor): StateTransformation => {
    const cursorHead = editor.getCursor().getHead();
    const insertAt = editor.convertSelectableOffsetToModelOffset(cursorHead);
    const transformation = new StateTransformation();
    transformation.addOperation(new stateOperations.Insert(insertAt, [char]));
    return transformation;
  };
}
