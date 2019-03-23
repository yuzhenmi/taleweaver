import {
  Editor,
  StateCommand,
  StateTransformation,
  stateOperations,
} from '@taleweaver/core';
import EditExtension from '../EditExtension';

export default function insertChar(editExtension: EditExtension, char: string): StateCommand {
  return (editor: Editor): StateTransformation => {
    const cursorAnchor = editor.getCursor().getAnchor();
    const cursorHead = editor.getCursor().getHead();
    const transformation = new StateTransformation();
    transformation.addOperation(new stateOperations.Insert(cursorHead, [char]));
    return transformation;
  };
}
