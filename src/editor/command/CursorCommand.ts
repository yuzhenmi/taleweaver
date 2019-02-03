import CursorTransformation from '../state/CursorTransformation';
import TaleWeaver from '../TaleWeaver';

type CursorCommand = (taleWeaver: TaleWeaver) => CursorTransformation;

export default CursorCommand;
