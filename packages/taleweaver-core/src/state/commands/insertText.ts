import Editor from '../../Editor';
import Command from './Command';
import Transformation from '../Transformation';
import Insert from '../operations/Insert';

export default function insertText(position: number, text: string): Command {
  return (editor: Editor): Transformation => {
    const transformation = new Transformation();
    const tokens = text.split('');
    transformation.addOperation(new Insert(position, tokens));
    return transformation;
  };
}
