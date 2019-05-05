import Editor from '../../Editor';
import Command from '../Command';
import StateTransformation from '../../token/Transformation';
import CursorTransformation from '../../cursor/Transformation';
import * as cursorOperations from '../../cursor/operations';

export default function moveTo(offset: number): Command {
  return (editor: Editor): [StateTransformation, CursorTransformation] => {
    const stateTransformation = new StateTransformation();
    const cursorTransformation = new CursorTransformation();
    cursorTransformation.addOperation(new cursorOperations.MoveTo(offset));
    return [stateTransformation, cursorTransformation];
  };
}
