import Editor from '../Editor';
import StateTransformation from '../state/Transformation';
import CursorTransformation from '../cursor/Transformation';

type Command = (editor: Editor) => [StateTransformation, CursorTransformation];

export default Command;
