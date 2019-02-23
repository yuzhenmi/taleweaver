import Transformation from '../cursor/Transformation';
import TaleWeaver from '../TaleWeaver';

type CursorCommand = (taleWeaver: TaleWeaver) => Transformation;

export default CursorCommand;
