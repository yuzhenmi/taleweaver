import TaleWeaver from '../../TaleWeaver';
import Command from './Command';
import Transformation from '../Transformation';
import Insert from '../operations/Insert';

export default function insertText(position: number, text: string): Command {
  return (taleWeaver: TaleWeaver): Transformation => {
    const transformation = new Transformation();
    const tokens = text.split('');
    transformation.addOperation(new Insert(position, tokens));
    return transformation;
  };
}
