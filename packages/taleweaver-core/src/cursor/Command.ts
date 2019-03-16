import CursorExtension from './CursorExtension';
import Transformation from './Transformation';

type Command = (cursorExtension: CursorExtension) => Transformation;

export default Command;
