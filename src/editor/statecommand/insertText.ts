import TaleWeaver from '../TaleWeaver';
import StateCommand from './StateCommand';
import StateTransformation from '../statetransformer/StateTransformation';
import Assign from '../statetransformer/steps/Assign';

export default function insertText(text: string): StateCommand {
  return (taleWeaver: TaleWeaver): StateTransformation => {
    const transformation = new StateTransformation();
    transformation.addStep(new Assign(text));
    return transformation;
  };
}
