import Transformation from '../Transformation';
import Editor from '../../Editor';

type Command = (editor: Editor) => Transformation;

export default Command;
