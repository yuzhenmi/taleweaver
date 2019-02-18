import CursorTransformation from '../transform/CursorTransformation';
import TaleWeaver from '../TaleWeaver';

type CursorCommand = (taleWeaver: TaleWeaver) => CursorTransformation;

export default CursorCommand;
