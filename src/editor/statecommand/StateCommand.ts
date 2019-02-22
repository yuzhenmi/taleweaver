import StateTransformation from '../statetransformer/StateTransformation';
import TaleWeaver from '../TaleWeaver';

type StateCommand = (taleWeaver: TaleWeaver) => StateTransformation;

export default StateCommand;
