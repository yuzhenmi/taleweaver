import CursorTransformation from '../cursortransformer/CursorTransformation';
import TaleWeaver from '../TaleWeaver';

type CursorCommand = (taleWeaver: TaleWeaver) => CursorTransformation;

export default CursorCommand;
