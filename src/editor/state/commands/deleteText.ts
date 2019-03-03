import TaleWeaver from '../../TaleWeaver';
import Command from './Command';
import Transformation from '../Transformation';
import Delete from '../operations/Delete';

export default function deleteText(positionFrom: number, positionTo: number): Command {
  return (taleWeaver: TaleWeaver): Transformation => {
    const transformation = new Transformation();
    transformation.addOperation(new Delete(positionFrom, positionTo));
    return transformation;
  };
}
