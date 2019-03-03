import Transformation from '../Transformation';
import TaleWeaver from '../../TaleWeaver';

type Command = (taleWeaver: TaleWeaver) => Transformation;

export default Command;
