import {
  Editor,
  Command,
  StateTransformation,
  CursorTransformation,
  stateOperations,
  cursorOperations,
  OpenTagToken,
  CloseTagToken,
  generateID,
} from '@taleweaver/core';
import EditExtension from '../EditExtension';

export default function breakLine(editExtension: EditExtension): Command {
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
    } else if (anchor > head) {
      stateTransformation.addOperation(new stateOperations.Delete(
        editor.convertSelectableOffsetToModelOffset(head),
        editor.convertSelectableOffsetToModelOffset(anchor),
      ));
    }
    const insertAt = Math.min(anchor, head);
    stateTransformation.addOperation(new stateOperations.Insert(
      editor.convertSelectableOffsetToModelOffset(insertAt),
      [
        '\n',
        new CloseTagToken(),
        new CloseTagToken(),
        new OpenTagToken('Paragraph', { id: generateID() }),
        new OpenTagToken('Text', { id: generateID() }),
      ],
    ));
    cursorTransformation.addOperation(new cursorOperations.MoveTo(insertAt + 1));
    return [stateTransformation, cursorTransformation];
  };
}
