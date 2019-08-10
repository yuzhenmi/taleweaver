import Editor from '../Editor';
import Transformation from '../transform/Transformation';

type Command = (editor: Editor) => Transformation;

export default Command;
