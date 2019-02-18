import TaleWeaver from '../../TaleWeaver';
import DocumentCommand from '../DocumentCommand';
import DocumentTransformation from '../../transform/DocumentTransformation';
import Assign from '../../transform/documenttransformationsteps/Assign';

export default function insertText(text: string): DocumentCommand {
  return (taleWeaver: TaleWeaver): DocumentTransformation => {
    const transformation = new DocumentTransformation();
    transformation.addStep(new Assign(text));
    return transformation;
  };
}
