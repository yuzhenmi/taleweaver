import TaleWeaver from '../../TaleWeaver';
import Transformation from '../Transformation';

type Command = (taleWeaver: TaleWeaver) => Transformation;

export default Command;
