import Editor from '../../Editor';
import Command from '../Command';
import StateTransformation from '../../state/Transformation';
import CursorTransformation from '../../cursor/Transformation';
import { Delete, Insert } from '../../state/operations';
import { MoveTo } from '../../cursor/operations';

export default function replace(from: number,to: number, content: string): Command {
  return (editor: Editor): [StateTransformation, CursorTransformation] => {
    const stateTransformation = new StateTransformation();
    const cursorTransformation = new CursorTransformation();
    const fromOffset = editor.convertSelectableOffsetToModelOffset(from);
    const toOffset = editor.convertSelectableOffsetToModelOffset(to);
    stateTransformation.addOperation(new Delete(fromOffset, toOffset));
    stateTransformation.addOperation(new Insert(fromOffset, content.split('')));
    cursorTransformation.addOperation(new MoveTo(from + content.length));
    return [stateTransformation, cursorTransformation];
  };
}
