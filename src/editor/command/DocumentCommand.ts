import DocumentTransformation from '../transform/DocumentTransformation';
import TaleWeaver from '../TaleWeaver';

type DocumentCommand = (taleWeaver: TaleWeaver) => DocumentTransformation;

export default DocumentCommand;
