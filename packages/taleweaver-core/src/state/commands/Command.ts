import Editor from '../../Editor';
import Transformation from '../Transformation';

type Command = (editor: Editor) => Transformation;

export default Command;
