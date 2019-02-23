import TaleWeaver from '../TaleWeaver';
import Transformation from '../state/Transformation';

type StateCommand = (taleWeaver: TaleWeaver) => Transformation;

export default StateCommand;
